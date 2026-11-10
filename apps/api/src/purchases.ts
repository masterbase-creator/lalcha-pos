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
import { audit, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, idParam, PAGE_SIZE, pageOf, parse } from "./http.ts";
import { ensureBatch, receiveSerials, takeStock } from "./stock.ts";
import { productSerials, products, purchaseLines, purchaseReceipts, purchaseReturnLines, purchaseReturns, purchases, stockLedger, supplierPayments, suppliers } from "./schema.ts";

type Line = { productId: string; qty: number; unitCostPoisha: number; batchNo?: string | null; expiresOn?: string | null; serials?: string[] };

const totalsOf = (lines: Line[], discountPoisha: number) =>
  computeTotals(lines.map((l) => ({ qty: l.qty, unitPricePoisha: l.unitCostPoisha })), discountPoisha);

/**
 * Adds received goods to stock and updates each product's weighted average cost.
 * Products are locked in a fixed order, so two simultaneous purchases can't deadlock or miscount.
 * Returns what these goods are worth, after their share of any bill discount.
 */
async function receiveIntoStock(tx: Tx, storeId: string, purchase: { id: string; branchId: string; subtotalPoisha: number; totalPoisha: number }, receiving: Line[], actorId: string) {
  const grouped = new Map<string, { qty: number; value: bigint }>();
  for (const l of receiving) {
    const entry = grouped.get(l.productId) ?? { qty: 0, value: 0n };
    entry.qty += l.qty;
    entry.value += purchase.subtotalPoisha === 0 ? 0n : (BigInt(l.qty) * BigInt(l.unitCostPoisha) * BigInt(purchase.totalPoisha)) / (BigInt(purchase.subtotalPoisha) * BigInt(QTY_SCALE));
    grouped.set(l.productId, entry);
  }
  let worth = 0n;
  for (const productId of [...grouped.keys()].sort()) {
    const { qty, value } = grouped.get(productId)!;
    worth += value;
    const where = and(eq(products.storeId, storeId), eq(products.id, productId), isNull(products.archivedAt));
    const [product] = await tx.select({ costPoisha: products.costPoisha, tracking: products.tracking }).from(products).where(where).for("update");
    if (!product) throw new ApiError("unknown_product");
    // Average cost is store-wide, so it counts stock across every branch.
    const stock = await stockOf(tx, storeId, productId);
    // Stock can be negative after offline sales; those units have no cost to average in.
    const held = BigInt(Math.max(Math.round(stock), 0));
    const units = held + BigInt(qty);
    const averageCost = (held * BigInt(product.costPoisha) + value * BigInt(QTY_SCALE) + units / 2n) / units;
    await tx.update(products).set({ costPoisha: Number(averageCost) }).where(where);
    // Each line goes into its own batch, so two batches of one medicine on one bill stay apart.
    for (const l of receiving.filter((r) => r.productId === productId)) {
      const batchId = product.tracking === "batch" && l.batchNo ? await ensureBatch(tx, storeId, productId, purchase.branchId, l.batchNo, l.expiresOn ?? null) : null;
      if (product.tracking === "serial" && l.serials?.length) await receiveSerials(tx, storeId, productId, purchase.branchId, l.serials, purchase.id);
      await tx.insert(stockLedger).values({ storeId, branchId: purchase.branchId, productId, qtyDelta: l.qty, reason: "purchase", refId: purchase.id, actorId, batchId });
    }
  }
  return Number(worth);
}

export async function supplierDues(tx: Tx, storeId: string, supplierId?: string) {
  const onlySupplier = (column: typeof purchases.supplierId | typeof supplierPayments.supplierId) =>
    supplierId ? eq(column, supplierId) : undefined;
  const billed = await tx
    .select({ id: purchases.supplierId, amount: sql<string>`sum(${purchases.receivedValuePoisha})` })
    .from(purchases)
    .where(and(eq(purchases.storeId, storeId), inArray(purchases.status, ["partial", "received"]), onlySupplier(purchases.supplierId)))
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

async function stockOf(tx: Tx, storeId: string, productId: string, branchId?: string) {
  const [{ stock }] = await tx
    .select({ stock: sql<number>`coalesce(sum(${stockLedger.qtyDelta}), 0)::float8` })
    .from(stockLedger)
    .where(and(eq(stockLedger.storeId, storeId), eq(stockLedger.productId, productId), branchId ? eq(stockLedger.branchId, branchId) : undefined));
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
      await withStore(store.id, async (tx) => {
        await tx.insert(suppliers).values({ storeId: store.id, id, ...input });
        await audit(tx, store.id, c.get("user").id, "supplier_create", id, { name: input.name });
      });
      return c.json({ id }, 201);
    }),
  );

  app.patch(
    "/v1/suppliers/:id",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, supplierInputSchema);
      const rows = await withStore(store.id, async (tx) => {
        await audit(tx, store.id, c.get("user").id, "supplier_update", id, { name: input.name });
        return tx.update(suppliers).set(input).where(activeSupplier(store.id, id)).returning({ id: suppliers.id });
      });
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
        await audit(tx, store.id, c.get("user").id, "supplier_remove", id);
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
          .limit(PAGE_SIZE + 1)
          .offset(pageOf(c).offset);
        return {
          supplier: { ...supplier, duePoisha: dues.get(id) ?? 0 },
          payments: payments.slice(0, PAGE_SIZE).map((p) => ({ ...p, paidAt: p.paidAt.toISOString() })),
          hasMore: payments.length > PAGE_SIZE,
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
        // Paying more than is owed is allowed: the extra stays as an advance, shown as a negative due.
        await tx.insert(supplierPayments).values({
          storeId: store.id,
          id: input.id,
          supplierId: id,
          amountPoisha: input.amountPoisha,
          method: input.method,
          ref: input.ref,
          createdBy: c.get("user").id,
        });
        await audit(tx, store.id, c.get("user").id, "supplier_payment", id, { amountPoisha: input.amountPoisha, method: input.method });
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
          .limit(PAGE_SIZE + 1)
          .offset(pageOf(c).offset),
      );
      return c.json<{ purchases: PurchaseSummary[]; hasMore: boolean }>({
        purchases: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, purchasedAt: r.purchasedAt.toISOString() })),
        hasMore: rows.length > PAGE_SIZE,
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
            tracking: products.tracking,
            qty: purchaseLines.qty,
            receivedQty: purchaseLines.receivedQty,
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
      const { subtotalPoisha, totalPoisha } = totalsOf(input.lines, input.discountPoisha);
      const branchId = c.get("device").branchId;
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
            branchId,
            receivedValuePoisha: input.receiveNow ? totalPoisha : 0,
            status: input.receiveNow ? "received" : "ordered",
            receivedAt: input.receiveNow ? new Date() : null,
            discountPoisha: input.discountPoisha,
            totalPoisha,
            createdBy: actor.id,
          })
          .onConflictDoNothing({ target: [purchases.storeId, purchases.id] })
          .returning({ id: purchases.id });
        if (!inserted.length) return; // Already saved: a retry must not add the stock again.
        await tx.insert(purchaseLines).values(input.lines.map((l, i) => ({ storeId: store.id, purchaseId: input.id, lineNo: i + 1, productId: l.productId, qty: l.qty, unitCostPoisha: l.unitCostPoisha, receivedQty: input.receiveNow ? l.qty : 0 })));
        await audit(tx, store.id, actor.id, "purchase_create", input.id, { totalPoisha, received: input.receiveNow });
        if (input.receiveNow) await receiveIntoStock(tx, store.id, { id: input.id, branchId, subtotalPoisha, totalPoisha }, input.lines, actor.id);
        // Money paid before delivery becomes an advance on the supplier's account.
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
        // One delivery at a time per order, so two people can't receive the same goods.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`purchase:${store.id}:${id}`}, 0))`);
        const [seen] = await tx.select({ id: purchaseReceipts.id }).from(purchaseReceipts).where(and(eq(purchaseReceipts.storeId, store.id), eq(purchaseReceipts.id, input.id)));
        if (seen) return; // A retried request must not add the delivery twice.
        const [p] = await tx.select().from(purchases).where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        if (!p) throw new ApiError("not_found", 404);
        if (p.status !== "ordered" && p.status !== "partial") throw new ApiError("not_open", 409);
        const lines = await tx.select().from(purchaseLines).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        const requested = input.lines ?? lines.filter((l) => l.qty > l.receivedQty).map((l) => ({ lineNo: l.lineNo, qty: l.qty - l.receivedQty, batchNo: null, expiresOn: null, serials: [] as string[] }));
        if (requested.length === 0) throw new ApiError("no_lines");
        const receiving: Line[] = requested.map((r) => {
          const line = lines.find((l) => l.lineNo === r.lineNo);
          if (!line) throw new ApiError("unknown_reference");
          if (r.qty > line.qty - line.receivedQty) throw new ApiError("exceeds_order");
          return { productId: line.productId, qty: r.qty, unitCostPoisha: line.unitCostPoisha, batchNo: r.batchNo, expiresOn: r.expiresOn, serials: r.serials };
        });
        const { subtotalPoisha } = totalsOf(lines, p.discountPoisha);
        let worth = await receiveIntoStock(tx, store.id, { id, branchId: p.branchId, subtotalPoisha, totalPoisha: p.totalPoisha }, receiving, actor.id);
        for (const r of requested) {
          await tx.update(purchaseLines).set({ receivedQty: sql`${purchaseLines.receivedQty} + ${r.qty}` }).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id), eq(purchaseLines.lineNo, r.lineNo)));
        }
        const complete = lines.every((l) => l.receivedQty + (requested.find((r) => r.lineNo === l.lineNo)?.qty ?? 0) >= l.qty);
        // The last delivery settles any rounding, so the bill ends exactly on its total.
        if (complete) worth = p.totalPoisha - p.receivedValuePoisha;
        await tx
          .update(purchases)
          .set({ status: complete ? "received" : "partial", receivedAt: new Date(), receivedValuePoisha: p.receivedValuePoisha + worth })
          .where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        await tx.insert(purchaseReceipts).values({ storeId: store.id, id: input.id, purchaseId: id, createdBy: actor.id });
        await audit(tx, store.id, actor.id, "purchase_receive", id, { worthPoisha: worth, complete });
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

  // The supplier won't send the rest: the bill stays at what actually arrived.
  app.post(
    "/v1/purchases/:id/close",
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        const rows = await tx
          .update(purchases)
          .set({ status: "received" })
          .where(and(eq(purchases.storeId, store.id), eq(purchases.id, id), eq(purchases.status, "partial")))
          .returning({ id: purchases.id });
        if (!rows.length) throw new ApiError("not_open", 409);
        await audit(tx, store.id, c.get("user").id, "purchase_close", id);
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
        if (p.status !== "received" && p.status !== "partial") throw new ApiError("not_open", 409);
        const lines = await tx.select().from(purchaseLines).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        const back = await returnedByLine(tx, store.id, id);
        const subtotal = lines.reduce((sum, l) => sum + lineAmount(l.qty, l.unitCostPoisha), 0);
        let value = 0;
        for (const request of [...input.lines].sort((a, b) => a.lineNo - b.lineNo)) {
          const line = lines.find((l) => l.lineNo === request.lineNo);
          if (!line) throw new ApiError("unknown_reference");
          if (request.qty > line.receivedQty - (back.get(line.lineNo) ?? 0)) throw new ApiError("exceeds_sold");
          const [product] = await tx.select({ id: products.id, tracking: products.tracking }).from(products).where(and(eq(products.storeId, store.id), eq(products.id, line.productId))).for("update");
          if ((await stockOf(tx, store.id, line.productId, p.branchId)) < request.qty) throw new ApiError("insufficient_stock");
          value += subtotal === 0 ? 0 : Math.floor((lineAmount(request.qty, line.unitCostPoisha) * p.totalPoisha) / subtotal);
          await takeStock(tx, { storeId: store.id, branchId: p.branchId, productId: line.productId, qty: request.qty, reason: "purchase_return", refId: input.id, actorId: actor.id }, product?.tracking === "batch");
        }
        await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.storeId, store.id), eq(suppliers.id, p.supplierId))).for("update");
        const dues = await supplierDues(tx, store.id, p.supplierId);
        const creditPoisha = Math.max(0, Math.min(value, dues.get(p.supplierId) ?? 0));
        const cashBackPoisha = value - creditPoisha;
        await tx.insert(purchaseReturns).values({ storeId: store.id, id: input.id, purchaseId: id, supplierId: p.supplierId, valuePoisha: value, creditPoisha, cashBackPoisha, createdBy: actor.id });
        await tx.insert(purchaseReturnLines).values(input.lines.map((l) => ({ storeId: store.id, returnId: input.id, purchaseId: id, lineNo: l.lineNo, qty: l.qty })));
        await audit(tx, store.id, actor.id, "purchase_return", id, { valuePoisha: value });
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
        if (p.status !== "received" && p.status !== "partial") throw new ApiError("not_open", 409);
        if ((await returnedByLine(tx, store.id, id)).size > 0) throw new ApiError("has_returns", 409);
        const lines = await tx.select().from(purchaseLines).where(and(eq(purchaseLines.storeId, store.id), eq(purchaseLines.purchaseId, id)));
        const { subtotalPoisha, totalPoisha } = totalsOf(lines, p.discountPoisha);
        for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const where = and(eq(products.storeId, store.id), eq(products.id, line.productId));
          const [product] = await tx.select({ costPoisha: products.costPoisha }).from(products).where(where).for("update");
          const stock = await stockOf(tx, store.id, line.productId);
          // Refused once the goods are sold: reversing them would invent stock the store doesn't have.
          if ((await stockOf(tx, store.id, line.productId, p.branchId)) < line.receivedQty) throw new ApiError("stock_already_used", 409);
          if (line.receivedQty === 0) continue;
          const left = BigInt(Math.round(stock - line.receivedQty));
          if (left > 0n && subtotalPoisha > 0) {
            const value = (BigInt(line.receivedQty) * BigInt(line.unitCostPoisha) * BigInt(totalPoisha)) / BigInt(subtotalPoisha);
            const cost = (BigInt(Math.round(stock)) * BigInt(product.costPoisha) - value + left / 2n) / left;
            await tx.update(products).set({ costPoisha: Number(cost < 0n ? 0n : cost) }).where(where);
          }
          // Reverses exactly what this purchase put in, batch by batch.
          const added = await tx
            .select({ qty: stockLedger.qtyDelta, batchId: stockLedger.batchId })
            .from(stockLedger)
            .where(and(eq(stockLedger.storeId, store.id), eq(stockLedger.refId, id), eq(stockLedger.productId, line.productId), eq(stockLedger.reason, "purchase")));
          await tx.insert(stockLedger).values(
            (added.length ? added : [{ qty: line.receivedQty, batchId: null }]).map((a) => ({ storeId: store.id, branchId: p.branchId, productId: line.productId, qtyDelta: -a.qty, reason: "purchase_void" as const, refId: id, actorId: actor.id, batchId: a.batchId })),
          );
          await tx.update(productSerials).set({ status: "returned" }).where(and(eq(productSerials.storeId, store.id), eq(productSerials.purchaseId, id), eq(productSerials.status, "in_stock")));
        }
        await tx.update(purchases).set({ status: "voided" }).where(and(eq(purchases.storeId, store.id), eq(purchases.id, id)));
        await audit(tx, store.id, actor.id, "purchase_void", id, { totalPoisha: p.totalPoisha });
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
      await withStore(store.id, (tx) => audit(tx, store.id, c.get("user").id, "purchase_cancel", id));
      return c.json({ ok: true });
    }),
  );
}
