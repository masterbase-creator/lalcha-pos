// Batch and serial bookkeeping. Plain products never touch this: their stock is just the ledger sum.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./db.ts";
import { productSerials, stockBatches, stockLedger } from "./schema.ts";

type Reason = (typeof stockLedger.$inferInsert)["reason"];

/** The batch with this number and expiry at this branch, created the first time it is seen. */
export async function ensureBatch(tx: Tx, storeId: string, productId: string, branchId: string, batchNo: string, expiresOn: string | null) {
  const [found] = await tx
    .select({ id: stockBatches.id })
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.storeId, storeId),
        eq(stockBatches.productId, productId),
        eq(stockBatches.branchId, branchId),
        eq(stockBatches.batchNo, batchNo),
        sql`coalesce(${stockBatches.expiresOn}, '9999-12-31') = coalesce(${expiresOn}::date, '9999-12-31')`,
      ),
    );
  if (found) return found.id;
  const [row] = await tx.insert(stockBatches).values({ storeId, productId, branchId, batchNo, expiresOn }).returning({ id: stockBatches.id });
  return row.id;
}

/**
 * Splits stock leaving a branch across its batches, earliest expiry first (first expired, first out).
 * Whatever no batch covers comes back with batchId null: the sale really happened, so the shortfall shows.
 */
export async function allocateFromBatches(tx: Tx, storeId: string, branchId: string, productId: string, qty: number) {
  // Two tills syncing at once must not both take the last of the same batch.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`batch:${storeId}:${branchId}:${productId}`}, 0))`);
  const batches = (await tx.execute(sql`
    select b.id, coalesce(sum(l.qty_delta), 0)::float8 as left_qty
    from stock_batches b
    left join stock_ledger l on l.store_id = b.store_id and l.batch_id = b.id
    where b.store_id = ${storeId} and b.branch_id = ${branchId} and b.product_id = ${productId}
    group by b.id, b.expires_on, b.created_at
    having coalesce(sum(l.qty_delta), 0) > 0
    order by b.expires_on nulls last, b.created_at
  `)) as unknown as { id: string; left_qty: number }[];
  const parts: { batchId: string | null; qty: number }[] = [];
  let remaining = qty;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.round(b.left_qty));
    parts.push({ batchId: b.id, qty: take });
    remaining -= take;
  }
  if (remaining > 0) parts.push({ batchId: null, qty: remaining });
  return parts;
}

/** Takes stock out, split by batch when the product is batch-tracked. */
export async function takeStock(
  tx: Tx,
  entry: { storeId: string; branchId: string; productId: string; qty: number; reason: Reason; refId: string | null; actorId: string | null; occurredAt?: Date },
  batchTracked: boolean,
) {
  const parts = batchTracked ? await allocateFromBatches(tx, entry.storeId, entry.branchId, entry.productId, entry.qty) : [{ batchId: null, qty: entry.qty }];
  await tx.insert(stockLedger).values(
    parts.map((p) => ({
      storeId: entry.storeId, branchId: entry.branchId, productId: entry.productId, qtyDelta: -p.qty, reason: entry.reason, refId: entry.refId,
      actorId: entry.actorId, batchId: p.batchId, ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    })),
  );
}

/** Pieces arriving in stock. A serial seen before (returned, or bought back) comes back into stock. */
export async function receiveSerials(tx: Tx, storeId: string, productId: string, branchId: string, serials: string[], purchaseId: string | null) {
  for (const serial of new Set(serials)) {
    await tx
      .insert(productSerials)
      .values({ storeId, productId, serial, branchId, status: "in_stock", purchaseId })
      .onConflictDoUpdate({ target: [productSerials.storeId, productSerials.productId, productSerials.serial], set: { status: "in_stock", branchId, purchaseId, saleId: null, soldAt: null } });
  }
}

/**
 * Marks pieces sold. A serial the store never recorded (sold before it was entered) is created as sold,
 * so the warranty can still be looked up.
 */
export async function sellSerials(tx: Tx, storeId: string, productId: string, branchId: string, serials: string[], saleId: string, soldAt: Date) {
  for (const serial of new Set(serials)) {
    await tx
      .insert(productSerials)
      .values({ storeId, productId, serial, branchId, status: "sold", saleId, soldAt })
      .onConflictDoUpdate({ target: [productSerials.storeId, productSerials.productId, productSerials.serial], set: { status: "sold", saleId, soldAt } });
  }
}

/** Puts back pieces from a sale that came back: the most recently sold ones first. */
export async function returnSerials(tx: Tx, storeId: string, productId: string, saleId: string, count: number, restock: boolean) {
  if (count <= 0) return;
  const sold = await tx
    .select({ id: productSerials.id })
    .from(productSerials)
    .where(and(eq(productSerials.storeId, storeId), eq(productSerials.productId, productId), eq(productSerials.saleId, saleId), eq(productSerials.status, "sold")))
    .limit(count);
  if (!sold.length) return;
  await tx
    .update(productSerials)
    .set(restock ? { status: "in_stock", saleId: null, soldAt: null } : { status: "returned" })
    .where(and(eq(productSerials.storeId, storeId), inArray(productSerials.id, sold.map((s) => s.id))));
}

/** The batch a sale took a product from, so a return goes back where it came from. */
export async function batchOfSale(tx: Tx, storeId: string, saleId: string, productId: string) {
  const [row] = await tx
    .select({ batchId: stockLedger.batchId })
    .from(stockLedger)
    .where(and(eq(stockLedger.storeId, storeId), eq(stockLedger.refId, saleId), eq(stockLedger.productId, productId), sql`${stockLedger.batchId} is not null`))
    .limit(1);
  return row?.batchId ?? null;
}
