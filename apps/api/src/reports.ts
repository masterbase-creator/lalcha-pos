import { QTY_SCALE, type ReportResponse } from "@lalcha/domain";
import { sql, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { managers } from "./auth.ts";
import { customerDues } from "./customers.ts";
import { withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded } from "./http.ts";
import { supplierDues } from "./purchases.ts";

const DAY_MS = 86_400_000;
const uuidQuery = z.string().uuid();
const LOW_STOCK = 5 * QTY_SCALE;
const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

async function rows<T>(tx: Tx, query: SQL) {
  return (await tx.execute(query)) as unknown as T[];
}

export function registerReports(app: Hono<Env>) {
  app.get(
    "/v1/reports",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const fromText = c.req.query("from");
      const toText = c.req.query("to");
      if (!isDate(fromText) || !isDate(toText)) throw new ApiError("invalid_range");
      // Days run midnight to midnight in Bangladesh, wherever the server is.
      const from = new Date(`${fromText}T00:00:00+06:00`);
      const to = new Date(new Date(`${toText}T00:00:00+06:00`).getTime() + DAY_MS);
      const span = (to.getTime() - from.getTime()) / DAY_MS;
      if (span < 1 || span > 366) throw new ApiError("invalid_range");
      const storeId = store.id;
      const branch = uuidQuery.safeParse(c.req.query("branch"));
      const only = (column: SQL) => (branch.success ? sql`and ${column} = ${branch.data}::uuid` : sql``);
      const onlyReturns = (column: SQL) =>
        branch.success ? sql`and ${column} in (select id from sales s2 where s2.store_id = ${storeId} and s2.branch_id = ${branch.data}::uuid)` : sql``;
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      const inRange = (column: SQL) => sql`${column} >= ${fromIso}::timestamptz and ${column} < ${toIso}::timestamptz`;
      const dhakaDay = (column: SQL) => sql`to_char(${column} at time zone 'Asia/Dhaka', 'YYYY-MM-DD')`;

      const report = await withStore(storeId, async (tx): Promise<ReportResponse> => {
        const [salesTotals] = await rows<{ bills: number; sales: number; discount: number }>(tx, sql`
          select count(*)::int as bills, coalesce(sum(total_poisha), 0)::float8 as sales, coalesce(sum(discount_poisha), 0)::float8 as discount
          from sales where store_id = ${storeId} ${only(sql`branch_id`)} and ${inRange(sql`sold_at`)}`);
        const [{ cost }] = await rows<{ cost: number }>(tx, sql`
          select coalesce(sum(l.qty * l.cost_poisha / 1000.0), 0)::float8 as cost from sale_lines l
          join sales s on s.store_id = l.store_id and s.id = l.sale_id
          where l.store_id = ${storeId} ${only(sql`s.branch_id`)} and ${inRange(sql`s.sold_at`)}`);
        const [returnTotals] = await rows<{ value: number; count: number }>(tx, sql`
          select coalesce(sum(value_poisha), 0)::float8 as value, count(*)::int as count
          from sale_returns where store_id = ${storeId} ${onlyReturns(sql`sale_id`)} and ${inRange(sql`created_at`)}`);
        // Items back on the shelf recover their cost. Damaged ones remain a loss.
        const [{ recovered }] = await rows<{ recovered: number }>(tx, sql`
          select coalesce(sum(l.qty * l.cost_poisha / 1000.0), 0)::float8 as recovered from sale_return_lines l
          join sale_returns r on r.store_id = l.store_id and r.id = l.return_id
          where l.store_id = ${storeId} and l.restocked ${onlyReturns(sql`r.sale_id`)} and ${inRange(sql`r.created_at`)}`);

        // A returned item takes its share of the bill's VAT back with it.
        const [{ vat }] = await rows<{ vat: number }>(tx, sql`
          select (coalesce((select sum(vat_poisha) from sales where store_id = ${storeId} ${only(sql`branch_id`)} and ${inRange(sql`sold_at`)}), 0)
            - coalesce((select sum(r.value_poisha * s.vat_poisha / nullif(s.total_poisha, 0)) from sale_returns r
                join sales s on s.store_id = r.store_id and s.id = r.sale_id
                where r.store_id = ${storeId} and ${inRange(sql`r.created_at`)}), 0))::float8 as vat`);

        const dayRows = await rows<{ day: string; sales: number; bills: number }>(tx, sql`
          select ${dhakaDay(sql`sold_at`)} as day, sum(total_poisha)::float8 as sales, count(*)::int as bills
          from sales where store_id = ${storeId} ${only(sql`branch_id`)} and ${inRange(sql`sold_at`)} group by 1`);
        const dayReturns = await rows<{ day: string; value: number }>(tx, sql`
          select ${dhakaDay(sql`created_at`)} as day, sum(value_poisha)::float8 as value
          from sale_returns where store_id = ${storeId} ${onlyReturns(sql`sale_id`)} and ${inRange(sql`created_at`)} group by 1`);
        const byDay = new Map(dayRows.map((d) => [d.day, d]));
        const returnedByDay = new Map(dayReturns.map((d) => [d.day, d.value]));
        const daily = Array.from({ length: span }, (_, i) => {
          const date = new Date(from.getTime() + i * DAY_MS + 6 * 3_600_000).toISOString().slice(0, 10);
          return { date, netPoisha: (byDay.get(date)?.sales ?? 0) - (returnedByDay.get(date) ?? 0), bills: byDay.get(date)?.bills ?? 0 };
        });

        const received = await rows<{ method: string; amount: number }>(tx, sql`
          select case when payment_method = 'baki' then baki_paid_method else payment_method end as method,
                 coalesce(sum(least(tendered_poisha, total_poisha)), 0)::float8 as amount
          from sales where store_id = ${storeId} ${only(sql`branch_id`)} and ${inRange(sql`sold_at`)} group by 1`);
        const [{ given }] = await rows<{ given: number }>(tx, sql`
          select coalesce(sum(total_poisha - tendered_poisha), 0)::float8 as given
          from sales where store_id = ${storeId} ${only(sql`branch_id`)} and payment_method = 'baki' and ${inRange(sql`sold_at`)}`);
        const collected = await rows<{ method: string; amount: number }>(tx, sql`
          select method, sum(amount_poisha)::float8 as amount from customer_payments
          where store_id = ${storeId} and ${inRange(sql`paid_at`)} group by 1`);
        const refunded = await rows<{ method: string; amount: number }>(tx, sql`
          select refund_method as method, sum(refund_poisha)::float8 as amount from sale_returns
          where store_id = ${storeId} ${onlyReturns(sql`sale_id`)} and refund_poisha > 0 and ${inRange(sql`created_at`)} group by 1`);
        const [{ supplierCash }] = await rows<{ supplierCash: number }>(tx, sql`
          select coalesce(sum(amount_poisha), 0)::float8 as "supplierCash" from supplier_payments
          where store_id = ${storeId} and method = 'cash' and ${inRange(sql`paid_at`)}`);

        const amount = (list: { method: string; amount: number }[], method: string) => list.find((r) => r.method === method)?.amount ?? 0;
        const payments = (["cash", "bkash", "nagad", "card"] as const).map((method) => ({
          method,
          receivedPoisha: amount(received, method) + amount(collected, method),
          refundedPoisha: amount(refunded, method),
        }));
        const cashIn = amount(received, "cash") + amount(collected, "cash");
        const [{ supplierCashBack }] = await rows<{ supplierCashBack: number }>(tx, sql`
          select coalesce(sum(cash_back_poisha), 0)::float8 as "supplierCashBack" from purchase_returns
          where store_id = ${storeId} and ${inRange(sql`created_at`)}`);
        const shiftRows = await rows<{ id: string; openedAt: Date | string; closedAt: Date | string | null; floatPoisha: number; expectedPoisha: number | null; countedPoisha: number | null; openedBy: string | null }>(tx, sql`
          select sh.id, sh.opened_at as "openedAt", sh.closed_at as "closedAt", sh.float_poisha::float8 as "floatPoisha",
                 sh.expected_poisha::float8 as "expectedPoisha", sh.counted_poisha::float8 as "countedPoisha", u.name as "openedBy"
          from shifts sh left join users u on u.store_id = sh.store_id and u.id = sh.opened_by
          where sh.store_id = ${storeId} and ${inRange(sql`sh.opened_at`)} order by sh.opened_at desc limit 20`);

        const topProducts = await rows<ReportResponse["topProducts"][number]>(tx, sql`
          select p.id, p.name_en as "nameEn", p.name_bn as "nameBn", p.image_url as "imageUrl",
                 p.unit, sum(l.qty * l.pack_qty / 1000.0)::float8 as qty, sum(l.qty * l.unit_price_poisha / 1000.0)::float8 as "salesPoisha"
          from sale_lines l
          join sales s on s.store_id = l.store_id and s.id = l.sale_id
          join products p on p.store_id = l.store_id and p.id = l.product_id
          where l.store_id = ${storeId} ${only(sql`s.branch_id`)} and ${inRange(sql`s.sold_at`)}
          group by p.store_id, p.id order by "salesPoisha" desc limit 10`);
        const cashiers = await rows<ReportResponse["cashiers"][number]>(tx, sql`
          select coalesce(u.name, '—') as name, count(*)::int as bills, sum(s.total_poisha)::float8 as "salesPoisha"
          from sales s left join users u on u.store_id = s.store_id and u.id = s.cashier_id
          where s.store_id = ${storeId} ${only(sql`s.branch_id`)} and ${inRange(sql`s.sold_at`)}
          group by 1 order by "salesPoisha" desc`);

        const stock = await rows<{ id: string; nameEn: string; nameBn: string; imageUrl: string | null; costPoisha: number; stock: number; unit: "pc" | "kg" | "litre" | "metre" }>(tx, sql`
          select p.id, p.name_en as "nameEn", p.name_bn as "nameBn", p.image_url as "imageUrl", p.cost_poisha::float8 as "costPoisha", p.unit,
                 coalesce(sum(m.qty_delta), 0)::float8 as stock
          from products p left join stock_ledger m on m.store_id = p.store_id and m.product_id = p.id ${only(sql`m.branch_id`)}
          where p.store_id = ${storeId} and p.archived_at is null group by p.store_id, p.id`);
        const customerOwed = [...(await customerDues(tx, storeId)).values()].reduce((sum, d) => sum + Math.max(d, 0), 0);
        const supplierOwed = [...(await supplierDues(tx, storeId)).values()].reduce((sum, d) => sum + Math.max(d, 0), 0);

        const netSales = salesTotals.sales - returnTotals.value;
        const netCost = cost - recovered;
        return {
          netSalesPoisha: netSales,
          vatPoisha: Math.round(vat),
          grossProfitPoisha: netSales - netCost,
          bills: salesTotals.bills,
          discountPoisha: salesTotals.discount,
          returnsPoisha: returnTotals.value,
          returnsCount: returnTotals.count,
          bakiGivenPoisha: given,
          bakiCollectedPoisha: collected.reduce((sum, r) => sum + r.amount, 0),
          cashMovementPoisha: cashIn - amount(refunded, "cash") - supplierCash + supplierCashBack,
          shifts: shiftRows.map((r) => ({ ...r, openedAt: new Date(r.openedAt).toISOString(), closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null })),
          daily,
          payments,
          topProducts,
          cashiers,
          lowStock: stock.filter((s) => s.stock <= LOW_STOCK).sort((a, b) => a.stock - b.stock).slice(0, 20),
          stockValuePoisha: stock.reduce((sum, s) => sum + (Math.max(s.stock, 0) * s.costPoisha) / QTY_SCALE, 0),
          bakiOutstandingPoisha: customerOwed,
          supplierOwedPoisha: supplierOwed,
        };
      });
      return c.json(report);
    }),
  );
}
