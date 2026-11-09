import {
  customerInputSchema,
  opPaymentSchema,
  opReturnSchema,
  shiftCloseSchema,
  shiftOpenSchema,
  syncOpsSchema,
  type RecentSale,
  lineAmount,
  returnCreateSchema,
  returnValue,
  supplierPaymentSchema,
  type CustomerDetail,
  type CustomerSummary,
  type ReturnResult,
  type SaleDetail,
  type SaleListItem,
} from "@lalcha/domain";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Hono } from "hono";
import { managers, requireDevice, staffOnly } from "./auth.ts";
import { pgCode, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, idParam, parse } from "./http.ts";
import { customerPayments, customers, products, saleLines, saleReturnLines, saleReturns, sales, shifts, stockLedger, users } from "./schema.ts";

/** A customer's baki is always: unpaid sales, minus collections, minus returns credited to it. */
export async function customerDues(tx: Tx, storeId: string, customerId?: string) {
  const only = customerId ? sql`and customer_id = ${customerId}` : sql``;
  const rows = (await tx.execute(sql`
    select id, sum(amount)::float8 as due from (
      select customer_id as id, total_poisha - tendered_poisha as amount from sales
        where store_id = ${storeId} and payment_method = 'baki' ${only}
      union all
      select customer_id, -amount_poisha from customer_payments where store_id = ${storeId} ${only}
      union all
      select customer_id, -credit_poisha from sale_returns where store_id = ${storeId} and customer_id is not null ${only}
    ) entries group by id
  `)) as unknown as { id: string; due: number }[];
  return new Map(rows.map((r) => [r.id, r.due]));
}

const oneCustomer = (storeId: string, id: string) => and(eq(customers.storeId, storeId), eq(customers.id, id));
const RECENT_DAYS = 45;

function duplicatePhone(e: unknown): never {
  if (pgCode(e) === "23505") throw new ApiError("duplicate_phone", 409);
  throw e;
}

export async function runSaleReturn(tx: Tx, storeId: string, actorId: string, saleId: string, input: z.output<typeof returnCreateSchema>, decidedCredit: number | null): Promise<ReturnResult> {
        // One return per sale at a time, so two people can't refund the same items.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${storeId}:${saleId}`}, 0))`);

        const [done] = await tx
          .select({ valuePoisha: saleReturns.valuePoisha, creditPoisha: saleReturns.creditPoisha, refundPoisha: saleReturns.refundPoisha })
          .from(saleReturns)
          .where(and(eq(saleReturns.storeId, storeId), eq(saleReturns.id, input.id)));
        if (done) return done; // A retried request must not refund twice.

        const [sale] = await tx.select().from(sales).where(and(eq(sales.storeId, storeId), eq(sales.id, saleId)));
        if (!sale) throw new ApiError("not_found", 404);
        const lines = await tx.select().from(saleLines).where(and(eq(saleLines.storeId, storeId), eq(saleLines.saleId, saleId)));
        const earlier = await tx
          .select({ lineNo: saleReturnLines.lineNo, qty: sql<number>`sum(${saleReturnLines.qty})::int` })
          .from(saleReturnLines)
          .where(and(eq(saleReturnLines.storeId, storeId), eq(saleReturnLines.saleId, saleId)))
          .groupBy(saleReturnLines.lineNo);
        const [{ priorValue, priorCredit }] = await tx
          .select({ priorValue: sql<number>`coalesce(sum(${saleReturns.valuePoisha}), 0)::float8`, priorCredit: sql<number>`coalesce(sum(${saleReturns.creditPoisha}), 0)::float8` })
          .from(saleReturns)
          .where(and(eq(saleReturns.storeId, storeId), eq(saleReturns.saleId, saleId)));

        const back = new Map(earlier.map((r) => [r.lineNo, r.qty]));
        const subtotal = lines.reduce((sum, l) => sum + lineAmount(l.qty, l.unitPricePoisha), 0);
        const planned = input.lines.map((request) => {
          const line = lines.find((l) => l.lineNo === request.lineNo);
          if (!line) throw new ApiError("unknown_reference");
          if (request.qty > line.qty - (back.get(line.lineNo) ?? 0)) throw new ApiError("exceeds_sold");
          return { request, line, value: returnValue(request.qty, line.unitPricePoisha, subtotal, sale.totalPoisha) };
        });

        const remaining = sale.totalPoisha - priorValue;
        const soldUnits = lines.reduce((sum, l) => sum + l.qty, 0);
        const backUnits = [...back.values()].reduce((a, b) => a + b, 0) + input.lines.reduce((sum, l) => sum + l.qty, 0);
        let value = Math.min(planned.reduce((sum, p) => sum + p.value, 0), remaining);
        // When everything has come back, rounding must not leave a few poisha behind.
        if (backUnits === soldUnits) value = remaining;
        planned[planned.length - 1].value += value - planned.reduce((sum, p) => sum + p.value, 0);

        let credit = 0;
        if (sale.paymentMethod === "baki" && sale.customerId) {
          await tx.select({ id: customers.id }).from(customers).where(oneCustomer(storeId, sale.customerId)).for("update");
          const dues = await customerDues(tx, storeId, sale.customerId);
          const unpaidOnSale = sale.totalPoisha - sale.tenderedPoisha - priorCredit;
          credit = Math.max(0, Math.min(value, unpaidOnSale, dues.get(sale.customerId) ?? 0));
          // A refund handed over during an outage stands as the till recorded it.
          if (decidedCredit !== null) credit = Math.min(value, decidedCredit);
        }
        const refund = value - credit;

        await tx.insert(saleReturns).values({
          storeId: storeId,
          id: input.id,
          saleId,
          customerId: sale.customerId,
          valuePoisha: value,
          creditPoisha: credit,
          refundPoisha: refund,
          refundMethod: input.refundMethod,
          refundRef: input.refundRef,
          createdBy: actorId,
        });
        await tx.insert(saleReturnLines).values(
          planned.map((p) => ({
            storeId: storeId,
            returnId: input.id,
            saleId,
            lineNo: p.line.lineNo,
            qty: p.request.qty,
            valuePoisha: p.value,
            costPoisha: p.line.costPoisha,
            restocked: p.request.restock,
          })),
        );
        const restock = planned.filter((p) => p.request.restock);
        if (restock.length) {
          await tx.insert(stockLedger).values(
            restock.map((p) => ({ storeId: storeId, productId: p.line.productId, qtyDelta: p.request.qty, reason: "return" as const, refId: input.id, actorId: actorId })),
          );
        }
        return { valuePoisha: value, creditPoisha: credit, refundPoisha: refund };
}

async function collect(tx: Tx, storeId: string, actorId: string, customerId: string, input: z.output<typeof supplierPaymentSchema>, allowOver: boolean) {
  // The lock stops two tills collecting the same baki at once.
  const [row] = await tx.select({ id: customers.id }).from(customers).where(oneCustomer(storeId, customerId)).for("update");
  if (!row) throw new ApiError("not_found", 404);
  const [existing] = await tx
    .select({ id: customerPayments.id })
    .from(customerPayments)
    .where(and(eq(customerPayments.storeId, storeId), eq(customerPayments.id, input.id)));
  if (existing) return; // A retried request must not collect twice.
  const dues = await customerDues(tx, storeId, customerId);
  // Money already taken during an outage is recorded, even if another till collected too.
  if (!allowOver && input.amountPoisha > (dues.get(customerId) ?? 0)) throw new ApiError("exceeds_due");
  await tx.insert(customerPayments).values({ storeId, id: input.id, customerId, amountPoisha: input.amountPoisha, method: input.method, ref: input.ref, createdBy: actorId });
}

export function registerCustomers(app: Hono<Env>) {
  // Tills keep this list so baki can be given during an outage.
  app.get(
    "/v1/customers",
    requireDevice,
    guarded(async (c) => {
      const store = c.get("store");
      const list = await withStore(store.id, async (tx) => {
        const rows = await tx
          .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address, creditLimitPoisha: customers.creditLimitPoisha })
          .from(customers)
          .where(and(eq(customers.storeId, store.id), isNull(customers.archivedAt)))
          .orderBy(customers.name);
        const dues = await customerDues(tx, store.id);
        return rows.map((r): CustomerSummary => ({ ...r, duePoisha: dues.get(r.id) ?? 0 }));
      });
      return c.json({ customers: list });
    }),
  );

  app.post(
    "/v1/customers",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, customerInputSchema);
      await withStore(store.id, (tx) =>
        tx
          .insert(customers)
          .values({ storeId: store.id, ...input })
          .onConflictDoNothing({ target: [customers.storeId, customers.id] }),
      ).catch(duplicatePhone);
      return c.json({ id: input.id }, 201);
    }),
  );

  app.patch(
    "/v1/customers/:id",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const { name, phone, address, creditLimitPoisha } = await parse(c, customerInputSchema);
      const rows = await withStore(store.id, (tx) =>
        tx.update(customers).set({ name, phone, address, creditLimitPoisha }).where(oneCustomer(store.id, id)).returning({ id: customers.id }),
      ).catch(duplicatePhone);
      if (!rows.length) throw new ApiError("not_found", 404);
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/customers/:id",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const detail = await withStore(store.id, async (tx): Promise<CustomerDetail> => {
        const [customer] = await tx
          .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address, creditLimitPoisha: customers.creditLimitPoisha })
          .from(customers)
          .where(oneCustomer(store.id, id));
        if (!customer) throw new ApiError("not_found", 404);
        const dues = await customerDues(tx, store.id, id);
        const saleRows = await tx
          .select({ id: sales.id, receiptNo: sales.receiptNo, soldAt: sales.soldAt, totalPoisha: sales.totalPoisha, paidPoisha: sales.tenderedPoisha })
          .from(sales)
          .where(and(eq(sales.storeId, store.id), eq(sales.customerId, id), eq(sales.paymentMethod, "baki")))
          .orderBy(desc(sales.soldAt))
          .limit(100);
        const payments = await tx
          .select({ id: customerPayments.id, amountPoisha: customerPayments.amountPoisha, method: customerPayments.method, ref: customerPayments.ref, paidAt: customerPayments.paidAt })
          .from(customerPayments)
          .where(and(eq(customerPayments.storeId, store.id), eq(customerPayments.customerId, id)))
          .orderBy(desc(customerPayments.paidAt))
          .limit(100);
        return {
          customer: { ...customer, duePoisha: dues.get(id) ?? 0 },
          sales: saleRows.map((s) => ({ ...s, soldAt: s.soldAt.toISOString() })),
          payments: payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() })),
        };
      });
      return c.json(detail);
    }),
  );

  app.post(
    "/v1/customers/:id/payments",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, supplierPaymentSchema);
      await withStore(store.id, (tx) => collect(tx, store.id, c.get("user").id, id, input, false));
      return c.json({ ok: true });
    }),
  );

  app.delete(
    "/v1/customers/:id",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        const [row] = await tx.select({ id: customers.id }).from(customers).where(oneCustomer(store.id, id)).for("update");
        if (!row) throw new ApiError("not_found", 404);
        const dues = await customerDues(tx, store.id, id);
        if ((dues.get(id) ?? 0) !== 0) throw new ApiError("customer_has_due", 409);
        await tx.update(customers).set({ archivedAt: new Date(), phone: null }).where(oneCustomer(store.id, id));
      });
      return c.json({ ok: true });
    }),
  );

  // Everything a till did during an outage arrives here, once it's back online.
  app.post(
    "/v1/sync/ops",
    guarded(async (c) => {
      const store = c.get("store");
      const { ops } = await parse(c, syncOpsSchema);
      const results: { id: string; status: "accepted" | "rejected"; reason?: string }[] = [];
      for (const op of ops) {
        try {
          await withStore(store.id, async (tx) => {
            const [actor] = await tx.select({ role: users.role }).from(users).where(and(eq(users.storeId, store.id), eq(users.id, op.actorId)));
            if (!actor) throw new ApiError("unknown_reference");
            if (op.kind === "customer_create") {
              const input = customerInputSchema.parse(op.payload);
              const taken = input.phone
                ? await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.storeId, store.id), eq(customers.phone, input.phone)))
                : [];
              // Two tills may add the same phone offline. Keep the customer so their baki isn't lost.
              await tx.insert(customers).values({ storeId: store.id, ...input, phone: taken.some((r) => r.id !== input.id) ? null : input.phone }).onConflictDoNothing({ target: [customers.storeId, customers.id] });
            } else if (op.kind === "customer_payment") {
              const input = opPaymentSchema.parse(op.payload);
              await collect(tx, store.id, op.actorId, input.customerId, input, true);
            } else if (op.kind === "sale_return") {
              if (actor.role === "cashier") throw new ApiError("forbidden");
              const input = opReturnSchema.parse(op.payload);
              await runSaleReturn(tx, store.id, op.actorId, input.saleId, input, input.creditPoisha);
            } else if (op.kind === "shift_open") {
              const input = shiftOpenSchema.parse(op.payload);
              await tx.insert(shifts).values({ storeId: store.id, id: input.id, openedBy: op.actorId, openedAt: new Date(input.openedAt), floatPoisha: input.floatPoisha }).onConflictDoNothing({ target: [shifts.storeId, shifts.id] });
            } else {
              const input = shiftCloseSchema.parse(op.payload);
              await tx
                .update(shifts)
                .set({ closedBy: op.actorId, closedAt: new Date(input.closedAt), expectedPoisha: input.expectedPoisha, countedPoisha: input.countedPoisha })
                .where(and(eq(shifts.storeId, store.id), eq(shifts.id, input.id)));
            }
          });
          results.push({ id: op.id, status: "accepted" });
        } catch (e) {
          if (e instanceof ApiError) results.push({ id: op.id, status: "rejected", reason: e.code });
          else if (e instanceof z.ZodError) results.push({ id: op.id, status: "rejected", reason: "invalid" });
          else if (pgCode(e) === "23503") results.push({ id: op.id, status: "rejected", reason: "unknown_reference" });
          else throw e;
        }
      }
      return c.json({ results });
    }),
  );

  // Only what changed since the till last asked, so this stays cheap at thousands of stores.
  app.get(
    "/v1/sync/recent-sales",
    guarded(async (c) => {
      const store = c.get("store");
      const sinceText = c.req.query("since");
      const since = sinceText && !Number.isNaN(Date.parse(sinceText)) ? new Date(sinceText) : new Date(0);
      const serverTime = new Date().toISOString();
      const list = await withStore(store.id, async (tx): Promise<RecentSale[]> => {
        const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000);
        const changed = await tx.select({ id: saleReturns.saleId }).from(saleReturns).where(and(eq(saleReturns.storeId, store.id), gt(saleReturns.createdAt, since)));
        const changedIds = [...new Set(changed.map((r) => r.id))];
        const rows = await tx
          .select({
            id: sales.id, receiptNo: sales.receiptNo, soldAt: sales.soldAt, totalPoisha: sales.totalPoisha, tenderedPoisha: sales.tenderedPoisha, discountPoisha: sales.discountPoisha,
            vatPoisha: sales.vatPoisha, paymentMethod: sales.paymentMethod, bakiPaidMethod: sales.bakiPaidMethod, customerId: sales.customerId, cashierName: users.name,
          })
          .from(sales)
          .leftJoin(users, and(eq(users.storeId, sales.storeId), eq(users.id, sales.cashierId)))
          .where(and(eq(sales.storeId, store.id), gt(sales.soldAt, cutoff), changedIds.length ? or(gt(sales.syncedAt, since), inArray(sales.id, changedIds)) : gt(sales.syncedAt, since)))
          .orderBy(desc(sales.soldAt))
          .limit(3000);
        if (!rows.length) return [];
        const ids = rows.map((r) => r.id);
        const lines = await tx
          .select({ saleId: saleLines.saleId, lineNo: saleLines.lineNo, productId: saleLines.productId, name: saleLines.name, qty: saleLines.qty, unitPricePoisha: saleLines.unitPricePoisha, unit: products.unit })
          .from(saleLines)
          .innerJoin(products, and(eq(products.storeId, saleLines.storeId), eq(products.id, saleLines.productId)))
          .where(and(eq(saleLines.storeId, store.id), inArray(saleLines.saleId, ids)))
          .orderBy(saleLines.lineNo);
        const backLines = await tx
          .select({ saleId: saleReturnLines.saleId, lineNo: saleReturnLines.lineNo, qty: sql<number>`sum(${saleReturnLines.qty})::float8` })
          .from(saleReturnLines)
          .where(and(eq(saleReturnLines.storeId, store.id), inArray(saleReturnLines.saleId, ids)))
          .groupBy(saleReturnLines.saleId, saleReturnLines.lineNo);
        const backValues = await tx
          .select({ saleId: saleReturns.saleId, value: sql<number>`sum(${saleReturns.valuePoisha})::float8`, credit: sql<number>`sum(${saleReturns.creditPoisha})::float8` })
          .from(saleReturns)
          .where(and(eq(saleReturns.storeId, store.id), inArray(saleReturns.saleId, ids)))
          .groupBy(saleReturns.saleId);
        return rows.map((r) => ({
          ...r,
          soldAt: r.soldAt.toISOString(),
          returnedPoisha: backValues.find((b) => b.saleId === r.id)?.value ?? 0,
          creditedPoisha: backValues.find((b) => b.saleId === r.id)?.credit ?? 0,
          lines: lines.filter((l) => l.saleId === r.id).map(({ saleId: _s, ...l }) => ({ ...l, returnedQty: backLines.find((b) => b.saleId === r.id && b.lineNo === l.lineNo)?.qty ?? 0 })),
        }));
      });
      return c.json({ sales: list, serverTime });
    }),
  );

  app.get(
    "/v1/sales",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const q = (c.req.query("q") ?? "").trim().slice(0, 40);
      const match = q ? sql`and strpos(lower(s.receipt_no), lower(${q})) > 0` : sql``;
      const rows = await withStore(store.id, (tx) =>
        tx.execute(sql`
          select s.id, s.receipt_no as "receiptNo", s.sold_at as "soldAt", s.total_poisha::float8 as "totalPoisha",
                 s.payment_method as "paymentMethod", u.name as "cashierName", cu.name as "customerName",
                 coalesce((select sum(r.value_poisha) from sale_returns r where r.store_id = s.store_id and r.sale_id = s.id), 0)::float8 as "returnedPoisha"
          from sales s
          left join users u on u.store_id = s.store_id and u.id = s.cashier_id
          left join customers cu on cu.store_id = s.store_id and cu.id = s.customer_id
          where s.store_id = ${store.id} ${match}
          order by s.sold_at desc limit 100
        `),
      );
      const list = (rows as unknown as (Omit<SaleListItem, "soldAt"> & { soldAt: Date | string })[]).map((r) => ({ ...r, soldAt: new Date(r.soldAt).toISOString() }));
      return c.json({ sales: list });
    }),
  );

  app.get(
    "/v1/sales/:id",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const detail = await withStore(store.id, async (tx): Promise<SaleDetail> => {
        const [sale] = await tx
          .select({
            id: sales.id, receiptNo: sales.receiptNo, soldAt: sales.soldAt, discountPoisha: sales.discountPoisha, totalPoisha: sales.totalPoisha,
            tenderedPoisha: sales.tenderedPoisha, paymentMethod: sales.paymentMethod,
          })
          .from(sales)
          .where(and(eq(sales.storeId, store.id), eq(sales.id, id)));
        if (!sale) throw new ApiError("not_found", 404);
        const lines = await tx
          .select({
            lineNo: saleLines.lineNo, productId: saleLines.productId, name: saleLines.name, qty: saleLines.qty, unitPricePoisha: saleLines.unitPricePoisha,
            imageUrl: products.imageUrl, nameEn: products.nameEn, nameBn: products.nameBn, unit: products.unit,
          })
          .from(saleLines)
          .innerJoin(products, and(eq(products.storeId, saleLines.storeId), eq(products.id, saleLines.productId)))
          .where(and(eq(saleLines.storeId, store.id), eq(saleLines.saleId, id)))
          .orderBy(saleLines.lineNo);
        const returned = await tx
          .select({ lineNo: saleReturnLines.lineNo, qty: sql<number>`sum(${saleReturnLines.qty})::int` })
          .from(saleReturnLines)
          .where(and(eq(saleReturnLines.storeId, store.id), eq(saleReturnLines.saleId, id)))
          .groupBy(saleReturnLines.lineNo);
        const back = new Map(returned.map((r) => [r.lineNo, r.qty]));
        return { ...sale, soldAt: sale.soldAt.toISOString(), lines: lines.map((l) => ({ ...l, returnedQty: back.get(l.lineNo) ?? 0 })) };
      });
      return c.json(detail);
    }),
  );

  app.post(
    "/v1/sales/:id/returns",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const saleId = idParam(c);
      const input = await parse(c, returnCreateSchema);
      const result = await withStore(store.id, (tx) => runSaleReturn(tx, store.id, actor.id, saleId, input, null));
      return c.json(result, 201);
    }),
  );

}
