import { branchInputSchema, planById, transferCreateSchema, type BranchRecord, type TransferRecord } from "@lalcha/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { managers, requireDevice, requireRole, requireSession } from "./auth.ts";
import { audit, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, idParam, pageOf, parse, PAGE_SIZE } from "./http.ts";
import { branches, products, stockLedger, stockTransferLines, stockTransfers, subscriptions } from "./schema.ts";

export async function mainBranchId(tx: Tx, storeId: string) {
  const [row] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.storeId, storeId), isNull(branches.archivedAt))).orderBy(branches.createdAt).limit(1);
  if (!row) throw new ApiError("no_branch", 409);
  return row.id;
}

async function branchExists(tx: Tx, storeId: string, id: string) {
  const [row] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.storeId, storeId), eq(branches.id, id), isNull(branches.archivedAt)));
  return Boolean(row);
}

export function registerBranches(app: Hono<Env>) {
  const owners = [requireDevice, requireSession, requireRole("owner")] as const;

  app.get(
    "/v1/branches",
    requireDevice,
    guarded(async (c) => {
      const store = c.get("store");
      const rows = await withStore(store.id, (tx) =>
        tx.select({ id: branches.id, name: branches.name, address: branches.address }).from(branches).where(and(eq(branches.storeId, store.id), isNull(branches.archivedAt))).orderBy(branches.createdAt),
      );
      return c.json<{ branches: BranchRecord[]; currentId: string }>({ branches: rows, currentId: c.get("device").branchId });
    }),
  );

  app.post(
    "/v1/branches",
    ...owners,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, branchInputSchema);
      await withStore(store.id, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`branches:${store.id}`}, 0))`);
        const [sub] = await tx.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.storeId, store.id));
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.storeId, store.id), isNull(branches.archivedAt)));
        if (count >= (planById(sub?.plan ?? "")?.maxBranches ?? 1)) throw new ApiError("branch_limit", 403);
        await tx.insert(branches).values({ storeId: store.id, id: input.id, name: input.name, address: input.address }).onConflictDoNothing({ target: [branches.storeId, branches.id] });
        await audit(tx, store.id, c.get("user").id, "branch_create", input.id, { name: input.name });
      });
      return c.json({ id: input.id }, 201);
    }),
  );

  app.patch(
    "/v1/branches/:id",
    ...owners,
    guarded(async (c) => {
      const store = c.get("store");
      const id = idParam(c);
      const input = await parse(c, branchInputSchema);
      await withStore(store.id, async (tx) => {
        const rows = await tx.update(branches).set({ name: input.name, address: input.address }).where(and(eq(branches.storeId, store.id), eq(branches.id, id))).returning({ id: branches.id });
        if (!rows.length) throw new ApiError("not_found", 404);
        await audit(tx, store.id, c.get("user").id, "branch_update", id, { name: input.name });
      });
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/transfers",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const page = pageOf(c);
      const result = await withStore(store.id, async (tx) => {
        const rows = (await tx.execute(sql`
          select t.id, t.status, t.created_at as "createdAt", t.from_branch_id as "fromBranchId", t.to_branch_id as "toBranchId", f.name as "fromName", d.name as "toName"
          from stock_transfers t
          join branches f on f.store_id = t.store_id and f.id = t.from_branch_id
          join branches d on d.store_id = t.store_id and d.id = t.to_branch_id
          where t.store_id = ${store.id} order by t.created_at desc limit ${PAGE_SIZE + 1} offset ${page.offset}
        `)) as unknown as (Omit<TransferRecord, "lines" | "createdAt"> & { createdAt: Date | string })[];
        const list = rows.slice(0, PAGE_SIZE);
        const lines = list.length
          ? ((await tx.execute(sql`
              select l.transfer_id as "transferId", l.product_id as "productId", p.name_en as "nameEn", p.name_bn as "nameBn", p.unit, l.qty::float8 as qty
              from stock_transfer_lines l join products p on p.store_id = l.store_id and p.id = l.product_id
              where l.store_id = ${store.id} and l.transfer_id in (${sql.join(list.map((r) => sql`${r.id}::uuid`), sql`, `)}) order by l.line_no
            `)) as unknown as ({ transferId: string } & TransferRecord["lines"][number])[])
          : [];
        return { transfers: list.map((r): TransferRecord => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), lines: lines.filter((l) => l.transferId === r.id) })), hasMore: rows.length > PAGE_SIZE };
      });
      return c.json(result);
    }),
  );

  app.post(
    "/v1/transfers",
    ...managers,
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const input = await parse(c, transferCreateSchema);
      await withStore(store.id, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`transfer:${store.id}:${input.id}`}, 0))`);
        const [existing] = await tx.select({ id: stockTransfers.id }).from(stockTransfers).where(and(eq(stockTransfers.storeId, store.id), eq(stockTransfers.id, input.id)));
        if (existing) return;
        if (!(await branchExists(tx, store.id, input.fromBranchId)) || !(await branchExists(tx, store.id, input.toBranchId))) throw new ApiError("unknown_branch");
        await tx.insert(stockTransfers).values({ storeId: store.id, id: input.id, fromBranchId: input.fromBranchId, toBranchId: input.toBranchId, status: "sent", createdBy: actor.id });
        await tx.insert(stockTransferLines).values(input.lines.map((l, i) => ({ storeId: store.id, transferId: input.id, lineNo: i + 1, productId: l.productId, qty: l.qty })));
        for (const line of [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, store.id), eq(products.id, line.productId))).for("update");
          if (!product) throw new ApiError("unknown_product");
          const [{ stock }] = await tx
            .select({ stock: sql<number>`coalesce(sum(${stockLedger.qtyDelta}), 0)::float8` })
            .from(stockLedger)
            .where(and(eq(stockLedger.storeId, store.id), eq(stockLedger.productId, line.productId), eq(stockLedger.branchId, input.fromBranchId)));
          if (stock < line.qty) throw new ApiError("insufficient_stock");
          await tx.insert(stockLedger).values({ storeId: store.id, branchId: input.fromBranchId, productId: line.productId, qtyDelta: -line.qty, reason: "transfer_out", refId: input.id, actorId: actor.id });
        }
        await audit(tx, store.id, actor.id, "transfer_send", input.id, { lines: input.lines.length });
      });
      return c.json({ id: input.id }, 201);
    }),
  );

  const finish = (status: "received" | "cancelled") =>
    guarded(async (c) => {
      const store = c.get("store");
      const actor = c.get("user");
      const id = idParam(c);
      await withStore(store.id, async (tx) => {
        const [t] = await tx
          .update(stockTransfers)
          .set({ status, finishedAt: new Date() })
          .where(and(eq(stockTransfers.storeId, store.id), eq(stockTransfers.id, id), eq(stockTransfers.status, "sent")))
          .returning({ from: stockTransfers.fromBranchId, to: stockTransfers.toBranchId });
        if (!t) throw new ApiError("not_open", 409);
        const lines = await tx.select().from(stockTransferLines).where(and(eq(stockTransferLines.storeId, store.id), eq(stockTransferLines.transferId, id)));
        await tx.insert(stockLedger).values(
          lines.map((l) => ({
            storeId: store.id,
            branchId: status === "received" ? t.to : t.from,
            productId: l.productId,
            qtyDelta: l.qty,
            reason: status === "received" ? ("transfer_in" as const) : ("transfer_cancel" as const),
            refId: id,
            actorId: actor.id,
          })),
        );
        await audit(tx, store.id, actor.id, status === "received" ? "transfer_receive" : "transfer_cancel", id);
      });
      return c.json({ ok: true });
    });

  app.post("/v1/transfers/:id/receive", ...managers, finish("received"));
  app.post("/v1/transfers/:id/cancel", ...managers, finish("cancelled"));
}
