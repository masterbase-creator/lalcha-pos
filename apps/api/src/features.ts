// Routes for the features a store switches on during onboarding: batches and expiry, serials and
// warranty, restaurant tables, loyalty (points, coupons, gift cards), and expenses with accounts.
import {
  couponInputSchema,
  EXPENSE_LABELS,
  expenseInputSchema,
  giftCardIssueSchema,
  pointsAdjustSchema,
  tableInputSchema,
  writeOffSchema,
  type BatchRecord,
  type CashbookEntry,
  type CouponRecord,
  type ExpenseCategory,
  type ExpenseRecord,
  type GiftCardRecord,
  type ProfitLoss,
  type SerialRecord,
} from "@lalcha/domain";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { managers, staffOnly } from "./auth.ts";
import { audit, pgCode, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, idParam, parse } from "./http.ts";
import { coupons, customers, expenses, giftCardLedger, giftCards, loyaltyLedger, restaurantTables, stockBatches, stockLedger } from "./schema.ts";

const DAY_MS = 86_400_000;
const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

async function rows<T>(tx: Tx, query: SQL) {
  return (await tx.execute(query)) as unknown as T[];
}

/** A date range in Bangladesh days, at most a year long. */
function range(c: { req: { query: (k: string) => string | undefined } }) {
  const fromText = c.req.query("from");
  const toText = c.req.query("to");
  if (!isDate(fromText) || !isDate(toText)) throw new ApiError("invalid_range");
  const from = new Date(`${fromText}T00:00:00+06:00`);
  const to = new Date(new Date(`${toText}T00:00:00+06:00`).getTime() + DAY_MS);
  const span = (to.getTime() - from.getTime()) / DAY_MS;
  if (span < 1 || span > 366) throw new ApiError("invalid_range");
  return { from: from.toISOString(), to: to.toISOString(), fromDay: fromText, toDay: toText };
}

/** Today in Bangladesh, as YYYY-MM-DD. */
const todayBd = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

export async function customerPoints(tx: Tx, storeId: string) {
  const list = await rows<{ customer_id: string; points: number }>(tx, sql`select customer_id, sum(points)::int as points from loyalty_ledger where store_id = ${storeId} group by customer_id`);
  return new Map(list.map((r) => [r.customer_id, r.points]));
}

export async function giftCardBalance(tx: Tx, storeId: string, cardId: string) {
  const [row] = await rows<{ balance: number }>(tx, sql`
    select (g.initial_poisha + coalesce((select sum(amount_poisha) from gift_card_ledger l where l.store_id = g.store_id and l.gift_card_id = g.id), 0))::float8 as balance
    from gift_cards g where g.store_id = ${storeId} and g.id = ${cardId}`);
  return row?.balance ?? 0;
}

export function registerFeatures(app: Hono<Env>) {
  /* ---------- Batches and expiry ---------- */

  app.get(
    "/v1/batches",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const within = z.coerce.number().int().min(0).max(3650).catch(60).parse(c.req.query("days") ?? "60");
      const list = await withStore(store.id, (tx) =>
        rows<BatchRecord & { product_id: string; batch_no: string; expires_on: string | null; name_en: string; name_bn: string; branch_name: string }>(tx, sql`
          select b.id, b.product_id, p.name_en, p.name_bn, p.unit, b.batch_no, b.expires_on::text, br.name as branch_name, sum(l.qty_delta)::float8 as qty
          from stock_batches b
          join products p on p.store_id = b.store_id and p.id = b.product_id
          join branches br on br.store_id = b.store_id and br.id = b.branch_id
          join stock_ledger l on l.store_id = b.store_id and l.batch_id = b.id
          where b.store_id = ${store.id} and b.expires_on is not null and b.expires_on <= (${todayBd()}::date + ${within}::int)
          group by b.store_id, b.id, p.name_en, p.name_bn, p.unit, br.name
          having sum(l.qty_delta) > 0
          order by b.expires_on
          limit 500`),
      );
      return c.json({
        batches: list.map((r) => ({ id: r.id, productId: r.product_id, nameEn: r.name_en, nameBn: r.name_bn, unit: r.unit, batchNo: r.batch_no, expiresOn: r.expires_on, qty: r.qty, branchName: r.branch_name })),
        today: todayBd(),
      });
    }),
  );

  // Expired or damaged stock leaves the shelf and the books, and shows as a loss in profit and loss.
  app.post(
    "/v1/batches/:id/write-off",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const batchId = idParam(c);
      const input = await parse(c, writeOffSchema);
      await withStore(store.id, async (tx) => {
        const [seen] = await tx.select({ id: stockLedger.id }).from(stockLedger).where(and(eq(stockLedger.storeId, store.id), eq(stockLedger.refId, input.id)));
        if (seen) return; // A retried request must not write off twice.
        const [batch] = await tx.select().from(stockBatches).where(and(eq(stockBatches.storeId, store.id), eq(stockBatches.id, batchId)));
        if (!batch) throw new ApiError("not_found", 404);
        const [{ left }] = await rows<{ left: number }>(tx, sql`select coalesce(sum(qty_delta), 0)::float8 as left from stock_ledger where store_id = ${store.id} and batch_id = ${batchId}`);
        if (input.qty > left) throw new ApiError("insufficient_stock");
        await tx.insert(stockLedger).values({ storeId: store.id, branchId: batch.branchId, productId: batch.productId, qtyDelta: -input.qty, reason: "write_off", refId: input.id, actorId: c.get("user").id, batchId });
        await audit(tx, store.id, c.get("user").id, "stock_write_off", batch.productId, { batchNo: batch.batchNo, qty: input.qty });
      });
      return c.json({ ok: true });
    }),
  );

  /* ---------- Serial numbers and warranty ---------- */

  app.get(
    "/v1/serials",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const q = (c.req.query("q") ?? "").trim();
      if (q.length < 3) return c.json({ serials: [] });
      const list = await withStore(store.id, (tx) =>
        rows<{ id: string; product_id: string; name_en: string; name_bn: string; serial: string; status: SerialRecord["status"]; sold_at: string | null; receipt_no: string | null; customer_name: string | null; warranty_months: number | null }>(tx, sql`
          select s.id, s.product_id, p.name_en, p.name_bn, s.serial, s.status, s.sold_at, sa.receipt_no, cu.name as customer_name, p.warranty_months
          from product_serials s
          join products p on p.store_id = s.store_id and p.id = s.product_id
          left join sales sa on sa.store_id = s.store_id and sa.id = s.sale_id
          left join customers cu on cu.store_id = s.store_id and cu.id = sa.customer_id
          where s.store_id = ${store.id} and s.serial ilike ${`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}
          order by s.created_at desc limit 20`),
      );
      return c.json({
        serials: list.map((r): SerialRecord => {
          const until = r.sold_at && r.warranty_months ? new Date(new Date(r.sold_at).setMonth(new Date(r.sold_at).getMonth() + r.warranty_months)).toISOString() : null;
          return { id: r.id, productId: r.product_id, nameEn: r.name_en, nameBn: r.name_bn, serial: r.serial, status: r.status, soldAt: r.sold_at ? new Date(r.sold_at).toISOString() : null, receiptNo: r.receipt_no, customerName: r.customer_name, warrantyMonths: r.warranty_months, warrantyUntil: until };
        }),
      });
    }),
  );

  /** Serials of one product still in stock, so the till can offer them. */
  app.get(
    "/v1/products/:id/serials",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const productId = idParam(c);
      const list = await withStore(store.id, (tx) =>
        rows<{ serial: string }>(tx, sql`select serial from product_serials where store_id = ${store.id} and product_id = ${productId} and branch_id = ${c.get("device").branchId} and status = 'in_stock' order by created_at limit 500`),
      );
      return c.json({ serials: list.map((r) => r.serial) });
    }),
  );

  /* ---------- Restaurant tables ---------- */

  app.post(
    "/v1/tables",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, tableInputSchema);
      await withStore(store.id, async (tx) => {
        await tx
          .insert(restaurantTables)
          .values({ storeId: store.id, ...input })
          .onConflictDoUpdate({ target: [restaurantTables.storeId, restaurantTables.id], set: { name: input.name, area: input.area, seats: input.seats, archivedAt: null } });
        await audit(tx, store.id, c.get("user").id, "table_save", input.id, { name: input.name });
      });
      return c.json({ ok: true });
    }),
  );

  app.delete(
    "/v1/tables/:id",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, (tx) => tx.update(restaurantTables).set({ archivedAt: new Date() }).where(and(eq(restaurantTables.storeId, store.id), eq(restaurantTables.id, id))));
      return c.json({ ok: true });
    }),
  );

  /* ---------- Coupons ---------- */

  app.get(
    "/v1/coupons",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const list = await withStore(store.id, (tx) =>
        tx
          .select({
            id: coupons.id, code: coupons.code, kind: coupons.kind, value: coupons.value, minSpendPoisha: coupons.minSpendPoisha, maxDiscountPoisha: coupons.maxDiscountPoisha,
            validUntil: coupons.validUntil, maxUses: coupons.maxUses, active: coupons.active,
            uses: sql<number>`(select count(*)::int from sales s where s.store_id = ${coupons.storeId} and s.coupon_code = ${coupons.code})`,
            discountGiven: sql<number>`(select coalesce(sum(discount_poisha), 0)::float8 from sales s where s.store_id = ${coupons.storeId} and s.coupon_code = ${coupons.code})`,
          })
          .from(coupons)
          .where(eq(coupons.storeId, store.id))
          .orderBy(desc(coupons.createdAt)),
      );
      return c.json<{ coupons: (CouponRecord & { discountGiven: number })[] }>({ coupons: list });
    }),
  );

  app.post(
    "/v1/coupons",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, couponInputSchema);
      try {
        await withStore(store.id, async (tx) => {
          const { id, ...rest } = input;
          await tx.insert(coupons).values({ storeId: store.id, id, ...rest }).onConflictDoUpdate({ target: [coupons.storeId, coupons.id], set: rest });
          await audit(tx, store.id, c.get("user").id, "coupon_save", id, { code: input.code, active: input.active });
        });
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError("duplicate_code", 409);
        throw e;
      }
      return c.json({ ok: true });
    }),
  );

  /* ---------- Gift cards ---------- */

  app.get(
    "/v1/gift-cards",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const list = await withStore(store.id, (tx) =>
        rows<{ id: string; code: string; initial_poisha: number; balance: number; expires_on: string | null; customer_name: string | null; created_at: string; disabled_at: string | null }>(tx, sql`
          select g.id, g.code, g.initial_poisha, (g.initial_poisha + coalesce(sum(l.amount_poisha), 0))::float8 as balance, g.expires_on::text, cu.name as customer_name, g.created_at, g.disabled_at
          from gift_cards g
          left join gift_card_ledger l on l.store_id = g.store_id and l.gift_card_id = g.id
          left join customers cu on cu.store_id = g.store_id and cu.id = g.customer_id
          where g.store_id = ${store.id}
          group by g.store_id, g.id, cu.name order by g.created_at desc limit 200`),
      );
      return c.json<{ giftCards: GiftCardRecord[] }>({
        giftCards: list.map((r) => ({ id: r.id, code: r.code, initialPoisha: Number(r.initial_poisha), balancePoisha: r.balance, expiresOn: r.expires_on, customerName: r.customer_name, createdAt: new Date(r.created_at).toISOString(), disabled: r.disabled_at !== null })),
      });
    }),
  );

  // Selling a gift card is money in now; spending it later is a payment, not a new sale.
  app.post(
    "/v1/gift-cards",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, giftCardIssueSchema);
      try {
        await withStore(store.id, async (tx) => {
          await tx
            .insert(giftCards)
            .values({ storeId: store.id, id: input.id, code: input.code, initialPoisha: input.amountPoisha, customerId: input.customerId, expiresOn: input.expiresOn, soldMethod: input.method, soldRef: input.ref, createdBy: c.get("user").id })
            .onConflictDoNothing({ target: [giftCards.storeId, giftCards.id] });
          await audit(tx, store.id, c.get("user").id, "gift_card_issue", input.id, { code: input.code, amountPoisha: input.amountPoisha, method: input.method });
        });
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError("duplicate_code", 409);
        throw e;
      }
      return c.json({ ok: true }, 201);
    }),
  );

  app.get(
    "/v1/gift-cards/:code",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const code = (c.req.param("code") ?? "").trim().toUpperCase().slice(0, 32);
      const result = await withStore(store.id, async (tx) => {
        const [card] = await tx.select().from(giftCards).where(and(eq(giftCards.storeId, store.id), eq(giftCards.code, code)));
        if (!card) throw new ApiError("unknown_gift_card", 404);
        if (card.disabledAt) throw new ApiError("gift_card_disabled", 409);
        if (card.expiresOn && card.expiresOn < todayBd()) throw new ApiError("gift_card_expired", 409);
        return { code: card.code, balancePoisha: await giftCardBalance(tx, store.id, card.id), expiresOn: card.expiresOn };
      });
      return c.json(result);
    }),
  );

  app.post(
    "/v1/gift-cards/:id/disable",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        await tx.update(giftCards).set({ disabledAt: new Date() }).where(and(eq(giftCards.storeId, store.id), eq(giftCards.id, id), isNull(giftCards.disabledAt)));
        await audit(tx, store.id, c.get("user").id, "gift_card_disable", id);
      });
      return c.json({ ok: true });
    }),
  );

  /* ---------- Points ---------- */

  app.get(
    "/v1/customers/:id/points",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const history = await withStore(store.id, (tx) =>
        tx
          .select({ id: loyaltyLedger.id, points: loyaltyLedger.points, reason: loyaltyLedger.reason, note: loyaltyLedger.note, at: loyaltyLedger.createdAt })
          .from(loyaltyLedger)
          .where(and(eq(loyaltyLedger.storeId, store.id), eq(loyaltyLedger.customerId, id)))
          .orderBy(desc(loyaltyLedger.createdAt))
          .limit(100),
      );
      return c.json({ balance: history.reduce((n, h) => n + h.points, 0), history: history.map((h) => ({ ...h, at: h.at.toISOString() })) });
    }),
  );

  app.post(
    "/v1/customers/:id/points",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, pointsAdjustSchema);
      await withStore(store.id, async (tx) => {
        const [found] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.storeId, store.id), eq(customers.id, id)));
        if (!found) throw new ApiError("not_found", 404);
        await tx.insert(loyaltyLedger).values({ storeId: store.id, id: input.id, customerId: id, points: input.points, reason: "adjust", note: input.note, actorId: c.get("user").id }).onConflictDoNothing();
        await audit(tx, store.id, c.get("user").id, "points_adjust", id, { points: input.points, note: input.note });
      });
      return c.json({ ok: true });
    }),
  );

  /* ---------- Expenses ---------- */

  app.get(
    "/v1/expenses",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const r = range(c);
      const list = await withStore(store.id, (tx) =>
        rows<{ id: string; category: ExpenseCategory; amount_poisha: number; method: ExpenseRecord["method"]; ref: string | null; note: string | null; spent_on: string; created_by_name: string | null }>(tx, sql`
          select e.id, e.category, e.amount_poisha, e.method, e.ref, e.note, e.spent_on::text, u.name as created_by_name
          from expenses e left join users u on u.store_id = e.store_id and u.id = e.created_by
          where e.store_id = ${store.id} and e.voided_at is null and e.spent_on between ${r.fromDay}::date and ${r.toDay}::date
          order by e.spent_on desc, e.created_at desc limit 1000`),
      );
      return c.json<{ expenses: ExpenseRecord[] }>({
        expenses: list.map((e) => ({ id: e.id, category: e.category, amountPoisha: Number(e.amount_poisha), method: e.method, ref: e.ref, note: e.note, spentOn: e.spent_on, createdByName: e.created_by_name })),
      });
    }),
  );

  app.post(
    "/v1/expenses",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, expenseInputSchema);
      if (input.spentOn > todayBd()) throw new ApiError("bad_date");
      await withStore(store.id, async (tx) => {
        await tx.insert(expenses).values({ storeId: store.id, branchId: c.get("device").branchId, createdBy: c.get("user").id, ...input }).onConflictDoNothing({ target: [expenses.storeId, expenses.id] });
        await audit(tx, store.id, c.get("user").id, "expense_add", input.id, { category: input.category, amountPoisha: input.amountPoisha });
      });
      return c.json({ ok: true }, 201);
    }),
  );

  // Voided, never deleted, so the activity log and past reports can still explain the change.
  app.post(
    "/v1/expenses/:id/void",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        const done = await tx.update(expenses).set({ voidedAt: new Date() }).where(and(eq(expenses.storeId, store.id), eq(expenses.id, id), isNull(expenses.voidedAt))).returning({ amount: expenses.amountPoisha });
        if (!done.length) throw new ApiError("not_found", 404);
        await audit(tx, store.id, c.get("user").id, "expense_void", id, { amountPoisha: done[0].amount });
      });
      return c.json({ ok: true });
    }),
  );

  /* ---------- Accounts ---------- */

  app.get(
    "/v1/accounts/pnl",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const r = range(c);
      return c.json<ProfitLoss>(await withStore(store.id, (tx) => profitLoss(tx, store.id, r)));
    }),
  );

  app.get(
    "/v1/accounts/cashbook",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const r = range(c);
      return c.json<{ entries: CashbookEntry[] }>({ entries: await withStore(store.id, (tx) => cashbook(tx, store.id, r)) });
    }),
  );

  /**
   * A double-entry journal as CSV (opens in Excel, imports into Tally and most accounting software):
   * every money movement as a debit and a credit line.
   */
  app.get(
    "/v1/accounts/export",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const r = range(c);
      const entries = await withStore(store.id, (tx) => cashbook(tx, store.id, r));
      const account = (method: string) => ({ cash: "Cash", bkash: "bKash", nagad: "Nagad", card: "Card / bank", bank: "Bank" })[method] ?? method;
      const counter: Record<string, string> = { sale: "Sales", baki: "Customer receivable", supplier: "Supplier payable", expense: "Expenses", refund: "Sales returns", gift_card: "Gift card liability" };
      const csv = [["Date", "Voucher", "Account", "Debit (BDT)", "Credit (BDT)", "Narration"]];
      entries.forEach((e, i) => {
        const date = new Date(Date.parse(e.at) + 6 * 3_600_000).toISOString().slice(0, 10);
        const amount = ((e.inPoisha || e.outPoisha) / 100).toFixed(2);
        const other = counter[e.kind] ?? "Suspense";
        if (e.inPoisha) {
          csv.push([date, String(i + 1), account(e.method), amount, "", e.detail]);
          csv.push([date, String(i + 1), other, "", amount, e.detail]);
        } else {
          csv.push([date, String(i + 1), other, amount, "", e.detail]);
          csv.push([date, String(i + 1), account(e.method), "", amount, e.detail]);
        }
      });
      const body = "﻿" + csv.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\r\n");
      return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="lalcha-journal-${r.fromDay}-to-${r.toDay}.csv"` } });
    }),
  );
}

async function profitLoss(tx: Tx, storeId: string, r: { from: string; to: string; fromDay: string; toDay: string }): Promise<ProfitLoss> {
  const [sales] = await rows<{ sales: number; vat: number; cost: number }>(tx, sql`
    select coalesce(sum(s.total_poisha), 0)::float8 as sales, coalesce(sum(s.vat_poisha), 0)::float8 as vat,
           coalesce((select sum(l.cost_poisha * l.qty / 1000.0) from sale_lines l join sales x on x.store_id = l.store_id and x.id = l.sale_id
                     where x.store_id = ${storeId} and x.sold_at >= ${r.from} and x.sold_at < ${r.to}), 0)::float8 as cost
    from sales s where s.store_id = ${storeId} and s.sold_at >= ${r.from} and s.sold_at < ${r.to}`);
  const [returns] = await rows<{ value: number; cost_back: number }>(tx, sql`
    select coalesce(sum(rt.value_poisha), 0)::float8 as value,
           coalesce((select sum(rl.cost_poisha * rl.qty / 1000.0) from sale_return_lines rl join sale_returns r2 on r2.store_id = rl.store_id and r2.id = rl.return_id
                     where r2.store_id = ${storeId} and r2.created_at >= ${r.from} and r2.created_at < ${r.to} and rl.restocked), 0)::float8 as cost_back
    from sale_returns rt where rt.store_id = ${storeId} and rt.created_at >= ${r.from} and rt.created_at < ${r.to}`);
  const [writeOff] = await rows<{ value: number }>(tx, sql`
    select coalesce(sum(-l.qty_delta * p.cost_poisha / 1000.0), 0)::float8 as value
    from stock_ledger l join products p on p.store_id = l.store_id and p.id = l.product_id
    where l.store_id = ${storeId} and l.reason = 'write_off' and l.occurred_at >= ${r.from} and l.occurred_at < ${r.to}`);
  const byCategory = await rows<{ category: ExpenseCategory; amount: number }>(tx, sql`
    select category, sum(amount_poisha)::float8 as amount from expenses
    where store_id = ${storeId} and voided_at is null and spent_on between ${r.fromDay}::date and ${r.toDay}::date
    group by category order by amount desc`);
  // VAT collected belongs to the government, so it isn't the shop's income.
  const netSales = sales.sales - returns.value - sales.vat;
  const cogs = Math.round(sales.cost - returns.cost_back);
  const gross = Math.round(netSales - cogs);
  const expensesTotal = byCategory.reduce((n, e) => n + e.amount, 0);
  const writeOffs = Math.round(writeOff.value);
  return {
    salesPoisha: sales.sales, returnsPoisha: returns.value, vatPoisha: sales.vat, netSalesPoisha: netSales, costOfGoodsPoisha: cogs, grossProfitPoisha: gross,
    expenses: byCategory.map((e) => ({ category: e.category, amountPoisha: e.amount })), expensesPoisha: expensesTotal, writeOffsPoisha: writeOffs,
    netProfitPoisha: gross - expensesTotal - writeOffs,
  };
}

/** Every taka in and out, oldest first: sales, baki collected, refunds, supplier payments, expenses and gift cards sold. */
async function cashbook(tx: Tx, storeId: string, r: { from: string; to: string; fromDay: string; toDay: string }): Promise<CashbookEntry[]> {
  const list = await rows<{ at: string; kind: string; detail: string; method: string; in_p: number; out_p: number }>(tx, sql`
    select * from (
      select sold_at as at, 'sale' as kind, 'Sale ' || receipt_no as detail,
             case when payment_method = 'baki' then baki_paid_method else payment_method end as method,
             (case when payment_method = 'baki' then tendered_poisha else total_poisha - points_poisha - gift_card_poisha end)::float8 as in_p, 0::float8 as out_p
      from sales where store_id = ${storeId} and sold_at >= ${r.from} and sold_at < ${r.to}
      union all
      select p.paid_at, 'baki', 'Baki collected: ' || c.name, p.method, p.amount_poisha::float8, 0
      from customer_payments p join customers c on c.store_id = p.store_id and c.id = p.customer_id
      where p.store_id = ${storeId} and p.paid_at >= ${r.from} and p.paid_at < ${r.to}
      union all
      select rt.created_at, 'refund', 'Refund on ' || s.receipt_no, rt.refund_method, 0, rt.refund_poisha::float8
      from sale_returns rt join sales s on s.store_id = rt.store_id and s.id = rt.sale_id
      where rt.store_id = ${storeId} and rt.refund_poisha > 0 and rt.created_at >= ${r.from} and rt.created_at < ${r.to}
      union all
      select sp.paid_at, 'supplier', 'Paid ' || su.name, sp.method, 0, sp.amount_poisha::float8
      from supplier_payments sp join suppliers su on su.store_id = sp.store_id and su.id = sp.supplier_id
      where sp.store_id = ${storeId} and sp.paid_at >= ${r.from} and sp.paid_at < ${r.to}
      union all
      select (e.spent_on::timestamp + interval '12 hours') at time zone 'Asia/Dhaka', 'expense', e.category || coalesce(': ' || e.note, ''), e.method, 0, e.amount_poisha::float8
      from expenses e where e.store_id = ${storeId} and e.voided_at is null and e.spent_on between ${r.fromDay}::date and ${r.toDay}::date
      union all
      select g.created_at, 'gift_card', 'Gift card sold ' || g.code, g.sold_method, g.initial_poisha::float8, 0
      from gift_cards g where g.store_id = ${storeId} and g.created_at >= ${r.from} and g.created_at < ${r.to}
    ) x where in_p > 0 or out_p > 0 order by at limit 5000`);
  return list.map((e) => ({
    at: new Date(e.at).toISOString(), kind: e.kind,
    detail: e.kind === "expense" ? (EXPENSE_LABELS[e.detail.split(":")[0] as ExpenseCategory]?.en ?? e.detail.split(":")[0]) + (e.detail.includes(":") ? e.detail.slice(e.detail.indexOf(":")) : "") : e.detail,
    method: e.method, inPoisha: e.in_p, outPoisha: e.out_p,
  }));
}
