import {
  computeTotals,
  QTY_SCALE,
  purchaseCreateSchema,
  lineAmount,
  purchaseReturnSchema,
  purchaseReceiveSchema,
  supplierInputSchema,
  supplierPaymentSchema,
  type PurchaseDetail,
  type PurchaseSummary,
  type SupplierDetail,
  type SupplierSummary,
} from "@lalcha/domain";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { managers } from "./auth.ts";
import { withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, idParam, parse } from "./http.ts";
import { products, purchaseLines, purchaseReturnLines, purchaseReturns, purchases, stockLedger, supplierPayments, suppliers } from "./schema.ts";

type Line = { productId: string; qty: number; unitCostPoisha: number };

const totalsOf = (lines: Line[], discountPoisha: number) =>
  computeTotals(lines.map((l) => ({ qty: l.qty, unitPricePoisha: l.unitCostPoisha })), discountPoisha);

/**
 * Adds received goods to stock and updates each product's weighted average cost.
 * Products are locked in a fixed order, so two simultaneous purchases can't deadlock or miscount.
 */
async function receiveIntoStock(tx: Tx, storeId: string, purchaseId: string, lines: Line[], discountPoisha: number, actorId: string) {
  const { subtotalPoisha, totalPoisha } = totalsOf(lines, discountPoisha);
  const grouped = new Map<string, { qty: number; value: bigint }>();
  for (const l of lines) {
    const entry = grouped.get(l.productId) ?? { qty: 0, value: 0n };
    entry.qty += l.qty;
    // A bill-level discount lowers what each item really cost.
    entry.value += subtotalPoisha === 0 ? 0n : (BigInt(l.qty) * BigInt(l.unitCostPoisha) * BigInt(totalPoisha)) / (BigInt(subtotalPoisha) * BigInt(QTY_SCALE));
    grouped.set(l.productId, entry);
  }

  for (const productId of [...grouped.keys()].sort()) {
    const { qty, value } = grouped.get(productId)!;
    const where = and(eq(products.storeId, storeId), eq(products.id, productId), isNull(products.archivedAt));
    const [product] = await tx.select({ costPoisha: products.costPoisha }).from(products).where(where).for("update");
    if (!product) throw new ApiError("unknown_product");
    const [{ stock }] = await tx
      .select({ stock: sql<number>`coalesce(sum(${stockLedger.qtyDelta}), 0)::float8` })
      .from(stockLedger)
      .where(and(eq(stockLedger.storeId, storeId), eq(stockLedger.productId, productId)));
    // Stock can be negative after offline sales; those units have no cost to average in.
    const held = BigInt(Math.max(stock, 0));
    const units = held + BigInt(qty);
    const averageCost = (held * BigInt(product.costPoisha) + value * BigInt(QTY_SCALE) + units / 2n) / units;
    await tx.update(products).set({ costPoisha: Number(averageCost) }).where(where);
    await tx.insert(stockLedger).values({ storeId, productId, qtyDelta: qty, reason: "purchase", refId: purchaseId, actorId });
  }
}

export async function supplierDues(tx: Tx, storeId: string, supplierId?: string) {
  const onlySupplier = (column: typeof purchases.supplierId | typeof supplierPayments.supplierId) =>
    supplierId ? eq(column, supplierId) : undefined;
  const billed = await tx
    .select({ id: purchases.supplierId, amount: sql<string>`sum(${purchases.totalPoisha})` })
    .from(purchases)
    .where(and(eq(purchases.storeId, storeId), eq(purchases.status, "received"), onlySupplier(purchases.supplierId)))
    .groupBy(purchases.supplierId);
  const paid = await tx
    .select({ id: supplierPayments.supplierId, amount: sql<string>`sum(${supplierPayments.amountPoisha})` })
    .from(supplierPayments)
    .where(and(eq(supplierPayments.storeId, storeId), onlySupplier(supplierPayments.supplierId)))
    .groupBy(supplierPayments.supplierId);
  const credited = await tx
    .select({ id: purchaseReturns.supplierId, amount: sql<string>`sum(${purchaseReturns.creditPoisha})` })
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.storeId, storeId), supplierId ? eq(purchaseReturns.supplierId, supplierId) : undefined))
    .groupBy(purchaseReturns.supplierId);
  const dues = new Map<string, number>();
  for (const b of billed) dues.set(b.id, Number(b.amount));
  for (const p of paid) dues.set(p.id, (dues.get(p.id) ?? 0) - Number(p.amount));
  for (const r of credited) dues.set(r.id, (dues.get(r.id) ?? 0) - Number(r.amount));
  return dues;
}

async function returnedByLine(tx: Tx, storeId: string, purchaseId: string) {
  const rows = await tx
    .select({ lineNo: purchaseReturnLines.lineNo, qty: sql<number>`sum(${purchaseReturnLines.qty})::float8` })
    .from(purchaseReturnLines)
    .where(and(eq(purchaseReturnLines.storeId, storeId), eq(purchaseReturnLines.purchaseId, purchaseId)))
    .groupBy(purchaseReturnLines.lineNo);
  return new Map(rows.map((r) => [r.lineNo, r.qty]));
}

async function stockOf(tx: Tx, storeId: string, productId: string) {
  const [{ stock }] = await tx
    .select({ stock: sql<number>`coalesce(sum(${stockLedger.qtyDelta}), 0)::float8` })
    .from(stockLedger)
    .where(and(eq(stockLedger.storeId, storeId), eq(stockLedger.productId, productId)));
  return stock;
}

const activeSupplier = (storeId: string, id: string) =>
  and(eq(suppliers.storeId, storeId), eq(suppliers.id, id), isNull(suppliers.archivedAt));

export function registerPurchases(app: Hono<Env>) {
  app.use("/v1/suppliers", ...managers);
  app.use("/v1/suppliers/*", ...managers);
  app.use("/v1/purchases", ...managers);
  app.use("/v1/purchases/*", ...managers);

  app.get(
    "/v1/products/costs",
    guarded(async (c) => {
      const store = c.get("store");
      const rows = await withStore(store.id, (tx) =>
        tx.select({ id: products.id, costPoisha: products.costPoisha }).from(products).where(and(eq(products.storeId, store.id), isNull(products.archivedAt))),
      );
      return c.json({ costs: rows });
    }),
  );

  app.get(
    "/v1/suppliers",
    guarded(async (c) => {
      const store = c.get("store");
      const result = await withStore(store.id, async (tx) => {
        const rows = await tx
          .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, address: suppliers.address })
          .from(suppliers)
          .where(and(eq(suppliers.storeId, store.id), isNull(suppliers.archivedAt)))
          .orderBy(suppliers.name);
        const dues = await supplierDues(tx, store.id);
        return rows.map((r): SupplierSummary => ({ ...r, duePoisha: dues.get(r.id) ?? 0 }));
      });
      return c.json({ suppliers: result });
    }),
  );

  app.post(
    "/v1/suppliers",
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, supplierInputSchema);
      const id = randomUUID();
      await withStore(store.id, (tx) => tx.insert(suppliers).values({ storeId: store.id, id, ...input }));
      return c.json({ id }, 201);
    }),
  );

  app.patch(
    "/v1/suppliers/:id",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, supplierInputSchema);
      const rows = await withStore(store.id, (tx) => tx.update(suppliers).set(input).where(activeSupplier(store.id, id)).returning({ id: suppliers.id }));
      if (!rows.length) throw new ApiError("not_found", 404);
      return c.json({ ok: true });
    }),
  );

  app.delete(
    "/v1/suppliers/:id",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        const [row] = await tx.select({ id: suppliers.id }).from(suppliers).where(activeSupplier(store.id, id)).for("update");
        if (!row) throw new ApiError("not_found", 404);
        const dues = await supplierDues(tx, store.id, id);
        if ((dues.get(id) ?? 0) !== 0) throw new ApiError("supplier_has_due", 409);
        await tx.update(suppliers).set({ archivedAt: new Date() }).where(activeSupplier(store.id, id));
      });
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/suppliers/:id",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const detail = await withStore(store.id, async (tx): Promise<SupplierDetail> => {
        const [supplier] = await tx
          .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, address: suppliers.address })
          .from(suppliers)
          .where(activeSupplier(store.id, id));
        if (!supplier) throw new ApiError("not_found", 404);
        const dues = await supplierDues(tx, store.id, id);
        const payments = await tx
          .select({
            id: supplierPayments.id,
            amountPoisha: supplierPayments.amountPoisha,
            method: supplierPayments.method,
            ref: supplierPayments.ref,
            paidAt: supplierPayments.paidAt,
          })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.storeId, store.id), eq(supplierPayments.supplierId, id)))
          .orderBy(desc(supplierPayments.paidAt))
          .limit(100);
        return {
          supplier: { ...supplier, duePoisha: dues.get(id) ?? 0 },
          payments: payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() })),
        };
      });
      return c.json(detail);
    }),
  );

  app.post(
    "/v1/suppliers/:id/payments",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, supplierPaymentSchema);
      await withStore(store.id, async (tx) => {
        // The lock stops two people paying the same due at once and overpaying it.
        const [row] = await tx.select({ id: suppliers.id }).from(suppliers).where(activeSupplier(store.id, id)).for("update");
        if (!row) throw new ApiError("not_found", 404);
        const [existing] = await tx
          .select({ id: supplierPayments.id })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.storeId, store.id), eq(supplierPayments.id, input.id)));
        if (existing) return; // A retried request must not pay twice.
        const dues = await supplierDues(tx, store.id, id);
        if (input.amountPoisha > (dues.get(id) ?? 0)) throw new ApiError("exceeds_due");
        await tx.insert(supplierPayments).values({
          storeId: store.id,
          id: input.id,
          supplierId: id,
          amountPoisha: input.amountPoisha,
          method: input.method,
          ref: input.ref,
          createdBy: c.get("user").id,
        });
      });
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/purchases",
    guarded(async (c) => {
      const store = c.get("store");
      const rows = await withStore(store.id, (tx) =>
        tx
          .select({
            id: purchases.id,
            supplierId: purchases.supplierId,
            supplierName: suppliers.name,
            invoiceNo: purchases.invoiceNo,
            purchasedAt: purchases.purchasedAt,
            status: purchases.status,
            totalPoisha: purchases.totalPoisha,
          })
          .from(purchases)
          .innerJoin(suppliers, and(eq(suppliers.storeId, purchases.storeId), eq(suppliers.id, purchases.supplierId)))
          .where(eq(purchases.storeId, store.id))
          .orderBy(desc(purchases.purchasedAt), desc(purchases.id))
          .limit(200),
      );
      return c.json<{ purchases: PurchaseSummary[] }>({
        purchases: rows.map((r) => ({ ...r, purchasedAt: r.purchasedAt.toISOString() })),
      });
    }),
  );

  app.get(
    "/v1/purchases/:id",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const detail = await withStore(store.id, async (tx): Promise<PurchaseDetail> => {
        const [p] = await tx
          .select({
            id: purchases.id,
            supplierId: purchases.supplierId,
            supplierName: suppliers.name,
            invoiceNo: purchases.invoiceNo,
            purchasedAt: purchases.purchasedAt,
            status: purchases.status,
            discountPoisha: purchases.discountPoisha,
            totalPoisha: purchases.totalPoisha,
          })
          .from(purchases)
          .innerJoin(suppliers, and(eq(suppliers.storeId, purchases.storeId), eq(suppliers.id, purchases.supplierId)))
          .where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        if (!p) throw new ApiError("not_found", 404);
        const lines = await tx
          .select({
            lineNo: purchaseLines.lineNo,
            productId: purchaseLines.productId,
            nameEn: products.nameEn,
            nameBn: products.nameBn,
            imageUrl: products.imageUrl,
            unit: products.unit,
            qty: purchaseLines.qty,
            unitCostPoisha: purchaseLines.unitCostPoisha,
          })
          .from(purchaseLines)
          .innerJoin(products, and(eq(products.storeId, purchaseLines.storeId), eq(products.id, purchaseLines.productId)))
          .where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)))
          .orderBy(purchaseLines.lineNo);
        const [{ paid }] = await tx
          .select({ paid: sql<string>`coalesce(sum(${supplierPayments.amountPoisha}), 0)` })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.storeId, store.id), eq(supplierPayments.purchaseId, id)));
        const back = await returnedByLine(tx, store.id, id);
        return { ...p, purchasedAt: p.purchasedAt.toISOString(), lines: lines.map((l) => ({ ...l, returnedQty: back.get(l.lineNo) ?? 0 })), paidPoisha: Number(paid) };
      });
      return c.json(detail);
    }),
  );

  app.post(
    "/v1/purchases",
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const input = await parse(c, purchaseCreateSchema);
      const { totalPoisha } = totalsOf(input.lines, input.discountPoisha);
      await withStore(store.id, async (tx) => {
        const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(activeSupplier(store.id, input.supplierId));
        if (!supplier) throw new ApiError("unknown_supplier");
        const inserted = await tx
          .insert(purchases)
          .values({
            storeId: store.id,
            id: input.id,
            supplierId: input.supplierId,
            invoiceNo: input.invoiceNo,
            purchasedAt: new Date(input.purchasedAt),
            status: input.receiveNow ? "received" : "ordered",
            receivedAt: input.receiveNow ? new Date() : null,
            discountPoisha: input.discountPoisha,
            totalPoisha,
            createdBy: actor.id,
          })
          .onConflictDoNothing({ target: [purchases.storeId, purchases.id] })
          .returning({ id: purchases.id });
        if (!inserted.length) return; // Already saved: a retry must not add the stock again.
        await tx.insert(purchaseLines).values(input.lines.map((l, i) => ({ storeId: store.id, purchaseId: input.id, lineNo: i + 1, ...l })));
        if (!input.receiveNow) return;
        await receiveIntoStock(tx, store.id, input.id, input.lines, input.discountPoisha, actor.id);
        if (input.paidPoisha > 0) {
          await tx.insert(supplierPayments).values({
            storeId: store.id,
            id: randomUUID(),
            supplierId: input.supplierId,
            purchaseId: input.id,
            amountPoisha: input.paidPoisha,
            method: input.paymentMethod,
            ref: input.paymentRef,
            createdBy: actor.id,
          });
        }
      });
      return c.json({ id: input.id }, 201);
    }),
  );

  app.post(
    "/v1/purchases/:id/receive",
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const id = idParam(c);
      const input = await parse(c, purchaseReceiveSchema);
      await withStore(store.id, async (tx) => {
        // Only one request can move an order out of "ordered", so stock can't be received twice.
        const [p] = await tx
          .update(purchases)
          .set({ status: "received", receivedAt: new Date() })
          .where(and(eq(purchases.storeId, store.id), eq(purchases.id, id), eq(purchases.status, "ordered")))
          .returning({ supplierId: purchases.supplierId, discountPoisha: purchases.discountPoisha, totalPoisha: purchases.totalPoisha });
        if (!p) throw new ApiError("not_open", 409);
        if (input.paidPoisha > p.totalPoisha) throw new ApiError("paid_exceeds_total");
        const lines = await tx
          .select({ productId: purchaseLines.productId, qty: purchaseLines.qty, unitCostPoisha: purchaseLines.unitCostPoisha })
          .from(purchaseLines)
          .where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        await receiveIntoStock(tx, store.id, id, lines, p.discountPoisha, actor.id);
        if (input.paidPoisha > 0) {
          await tx.insert(supplierPayments).values({
            storeId: store.id,
            id: randomUUID(),
            supplierId: p.supplierId,
            purchaseId: id,
            amountPoisha: input.paidPoisha,
            method: input.paymentMethod,
            ref: input.paymentRef,
            createdBy: actor.id,
          });
        }
      });
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/purchases/:id/returns",
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const id = idParam(c);
      const input = await parse(c, purchaseReturnSchema);
      const result = await withStore(store.id, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`purchase:${store.id}:${id}`}, 0))`);
        const [done] = await tx
          .select({ valuePoisha: purchaseReturns.valuePoisha, creditPoisha: purchaseReturns.creditPoisha, cashBackPoisha: purchaseReturns.cashBackPoisha })
          .from(purchaseReturns)
          .where(and(eq(purchaseReturns.storeId, store.id), eq(purchaseReturns.id, input.id)));
        if (done) return done;
        const [p] = await tx.select().from(purchases).where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        if (!p) throw new ApiError("not_found", 404);
        if (p.status !== "received") throw new ApiError("not_open", 409);
        const lines = await tx.select().from(purchaseLines).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        const back = await returnedByLine(tx, store.id, id);
        const subtotal = lines.reduce((sum, l) => sum + lineAmount(l.qty, l.unitCostPoisha), 0);
        let value = 0;
        for (const request of [...input.lines].sort((a, b) => a.lineNo - b.lineNo)) {
          const line = lines.find((l) => l.lineNo === request.lineNo);
          if (!line) throw new ApiError("unknown_reference");
          if (request.qty > line.qty - (back.get(line.lineNo) ?? 0)) throw new ApiError("exceeds_sold");
          await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, store.id), eq(products.id, line.productId))).for("update");
          if ((await stockOf(tx, store.id, line.productId)) < request.qty) throw new ApiError("insufficient_stock");
          value += subtotal === 0 ? 0 : Math.floor((lineAmount(request.qty, line.unitCostPoisha) * p.totalPoisha) / subtotal);
          await tx.insert(stockLedger).values({ storeId: store.id, productId: line.productId, qtyDelta: -request.qty, reason: "purchase_return", refId: input.id, actorId: actor.id });
        }
        await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.storeId, store.id), eq(suppliers.id, p.supplierId))).for("update");
        const dues = await supplierDues(tx, store.id, p.supplierId);
        const creditPoisha = Math.max(0, Math.min(value, dues.get(p.supplierId) ?? 0));
        const cashBackPoisha = value - creditPoisha;
        await tx.insert(purchaseReturns).values({ storeId: store.id, id: input.id, purchaseId: id, supplierId: p.supplierId, valuePoisha: value, creditPoisha, cashBackPoisha, createdBy: actor.id });
        await tx.insert(purchaseReturnLines).values(input.lines.map((l) => ({ storeId: store.id, returnId: input.id, purchaseId: id, lineNo: l.lineNo, qty: l.qty })));
        return { valuePoisha: value, creditPoisha, cashBackPoisha };
      });
      return c.json(result, 201);
    }),
  );

  app.post(
    "/v1/purchases/:id/void",
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`purchase:${store.id}:${id}`}, 0))`);
        const [p] = await tx.select().from(purchases).where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        if (!p) throw new ApiError("not_found", 404);
        if (p.status !== "received") throw new ApiError("not_open", 409);
        if ((await returnedByLine(tx, store.id, id)).size > 0) throw new ApiError("has_returns", 409);
        const lines = await tx.select().from(purchaseLines).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        const { subtotalPoisha, totalPoisha } = totalsOf(lines, p.discountPoisha);
        for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const where = and(eq(products.storeId, store.id), eq(products.id, line.productId));
          const [product] = await tx.select({ costPoisha: products.costPoisha }).from(products).where(where).for("update");
          const stock = await stockOf(tx, store.id, line.productId);
          // Refused once the goods are sold: reversing them would invent stock the store doesn't have.
          if (stock < line.qty) throw new ApiError("stock_already_used", 409);
          const left = BigInt(Math.round(stock - line.qty));
          if (left > 0n && subtotalPoisha > 0) {
            const value = (BigInt(line.qty) * BigInt(line.unitCostPoisha) * BigInt(totalPoisha)) / BigInt(subtotalPoisha);
            const cost = (BigInt(Math.round(stock)) * BigInt(product.costPoisha) - value + left / 2n) / left;
            await tx.update(products).set({ costPoisha: Number(cost < 0n ? 0n : cost) }).where(where);
          }
          await tx.insert(stockLedger).values({ storeId: store.id, productId: line.productId, qtyDelta: -line.qty, reason: "purchase_void", refId: id, actorId: actor.id });
        }
        await tx.update(purchases).set({ status: "voided" }).where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        // Money paid with this bill comes back as a reversing entry, so payment history stays intact.
        const [{ paid }] = await tx
          .select({ paid: sql<string>`coalesce(sum(${supplierPayments.amountPoisha}), 0)` })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.storeId, store.id), eq(supplierPayments.purchaseId, id)));
        if (Number(paid) > 0) {
          await tx.insert(supplierPayments).values({ storeId: store.id, id: randomUUID(), supplierId: p.supplierId, purchaseId: id, amountPoisha: -Number(paid), method: "cash", ref: "VOID", createdBy: actor.id });
        }
      });
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/purchases/:id/cancel",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const rows = await withStore(store.id, (tx) =>
        tx
          .update(purchases)
          .set({ status: "cancelled" })
          .where(and(eq(purchases.storeId, store.id), eq(purchases.id, id), inArray(purchases.status, ["ordered"])))
          .returning({ id: purchases.id }),
      );
      if (!rows.length) throw new ApiError("not_open", 409);
      return c.json({ ok: true });
    }),
  );
}
