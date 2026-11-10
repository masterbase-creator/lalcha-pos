import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  MAX_IMAGE_BYTES,
  computeBill,
  importRowsSchema,
  productCreateSchema,
  productUpdateSchema,
  saleSchema,
  syncRequestSchema,
  QTY_SCALE,
  type CatalogResponse,
  type Pack,
  type ProductCreate,
  type ProductUpdate,
  type SyncResult,
} from "@lalcha/domain";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fileURLToPath } from "node:url";
import { managers, registerAuth, requireDevice } from "./auth.ts";
import { config } from "./config.ts";
import { audit, db, pgCode, withStore, type Env, type Tx } from "./db.ts";
import { ApiError } from "./http.ts";
import { registerBranches } from "./branches.ts";
import { getSettings, getSubscription, registerBilling, registerPlatform, registerPublic, requireActiveSubscription } from "./billing.ts";
import { registerCustomers } from "./customers.ts";
import { registerDemo } from "./demo.ts";
import { registerInbox } from "./inbox.ts";
import { registerPurchases } from "./purchases.ts";
import { registerReports } from "./reports.ts";
import { auditLog, branches, productPacks, products, saleLines, sales, stockLedger, stores, users } from "./schema.ts";

function subdomainFrom(host: string | undefined) {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const suffix = `.${config.baseDomain}`;
  if (hostname.endsWith(suffix)) {
    const subdomain = hostname.slice(0, -suffix.length);
    return subdomain.includes(".") ? null : subdomain;
  }
  return config.isProduction ? null : "demo";
}

const app = new Hono<Env>();

app.get("/health", (c) => c.json({ ok: true }));
app.use("/products/*", serveStatic({ root: fileURLToPath(new URL("../public", import.meta.url)) }));

// Incoming mail can carry photos and PDFs, so its webhook gets more room than the till's requests.
const smallBody = bodyLimit({ maxSize: 2 * 1024 * 1024 });
const mailBody = bodyLimit({ maxSize: 25 * 1024 * 1024 });
app.use("/v1/*", (c, next) => (c.req.path === "/v1/mail/inbound" ? mailBody(c, next) : smallBody(c, next)));
app.use("/v1/*", async (c, next) => {
  // Signup and your own admin page happen before, or outside, any one store.
  if (c.req.path.startsWith("/v1/public/") || c.req.path.startsWith("/v1/platform/") || c.req.path.startsWith("/v1/mail/")) return next();
  const subdomain = subdomainFrom(c.req.header("host"));
  if (!subdomain) return c.json({ error: "unknown_store" }, 404);
  const [store] = await db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.subdomain, subdomain));
  if (!store) return c.json({ error: "unknown_store" }, 404);
  c.set("store", store);
  await next();
});

registerPublic(app);
registerPlatform(app);
registerInbox(app);
registerDemo(app);
for (const path of ["/v1/products", "/v1/products/*", "/v1/suppliers", "/v1/suppliers/*", "/v1/purchases", "/v1/purchases/*", "/v1/customers", "/v1/customers/*", "/v1/sales/*", "/v1/staff", "/v1/staff/*", "/v1/devices/*", "/v1/branches", "/v1/branches/*", "/v1/transfers", "/v1/transfers/*"]) {
  app.use(path, requireActiveSubscription);
}
registerAuth(app);
registerBilling(app);
app.use("/v1/catalog", requireDevice);
app.use("/v1/sync/*", requireDevice);
app.use("/v1/products", ...managers);
app.use("/v1/products/*", ...managers);
registerBranches(app);
registerPurchases(app);
registerCustomers(app);
registerReports(app);

app.get("/v1/catalog", async (c) => {
  const store = c.get("store");
  const device = c.get("device");
  const [rows, subscription, settings, branch] = await withStore(store.id, async (tx) => [await
    tx
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        nameEn: products.nameEn,
        nameBn: products.nameBn,
        category: products.category,
        pricePoisha: products.pricePoisha,
        imageUrl: products.imageUrl,
        unit: products.unit,
        vatRateBp: products.vatRateBp,
        variantOf: products.variantOf,
        variantName: products.variantName,
        stock: sql<number>`coalesce(sum(${stockLedger.qtyDelta}), 0)::float8`,
      })
      .from(products)
      .leftJoin(stockLedger, and(eq(stockLedger.storeId, products.storeId), eq(stockLedger.productId, products.id), eq(stockLedger.branchId, device.branchId)))
      .where(isNull(products.archivedAt))
      .groupBy(products.storeId, products.id)
      .orderBy(products.category, products.nameEn), await getSubscription(tx, store.id), await getSettings(tx, store.id), (await tx.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.storeId, store.id), eq(branches.id, device.branchId))))[0]] as const,
  );
  const packs = await withStore(store.id, (tx) =>
    tx.select({ id: productPacks.id, productId: productPacks.productId, name: productPacks.name, qty: productPacks.qty, pricePoisha: productPacks.pricePoisha, barcode: productPacks.barcode }).from(productPacks).where(eq(productPacks.storeId, store.id)),
  );
  const packsOf = new Map<string, Pack[]>();
  for (const { productId, ...pack } of packs) packsOf.set(productId, [...(packsOf.get(productId) ?? []), pack]);
  const list = rows.map((r) => ({ ...r, packs: packsOf.get(r.id) ?? [] }));
  return c.json<CatalogResponse>({ store: { name: store.name }, products: list, subscription, settings, branch });
});

const UNIQUE_VIOLATION = "23505";
const uuidParam = z.string().uuid();

/** Turns a duplicate SKU or barcode into a message the form can show. */
function duplicateError(e: unknown) {
  if (pgCode(e) !== UNIQUE_VIOLATION) return null;
  const err = e as { constraint_name?: string; cause?: { constraint_name?: string } };
  const constraint = err.constraint_name ?? err.cause?.constraint_name ?? "";
  return constraint.includes("barcode") ? "duplicate_barcode" : "duplicate_sku";
}

/** Each name falls back to the other, so a shop may enter just one language. */
const fields = (p: ProductCreate | ProductUpdate) => ({
  nameEn: p.nameEn || p.nameBn,
  nameBn: p.nameBn || p.nameEn,
  category: p.category,
  pricePoisha: p.pricePoisha,
  costPoisha: p.costPoisha,
  barcode: p.barcode,
  unit: p.unit,
  vatRateBp: p.vatRateBp,
  variantOf: p.variantOf,
  variantName: p.variantOf ? p.variantName : p.variantName || null,
});

/**
 * Points a variant at the top of its group, so groups stay one level deep. A product that already
 * has variants can't become a variant itself.
 */
async function resolveVariantOf(tx: Tx, storeId: string, id: string, variantOf: string | null) {
  if (!variantOf || variantOf === id) return null;
  const [target] = await tx.select({ id: products.id, variantOf: products.variantOf }).from(products).where(activeProduct(storeId, variantOf));
  if (!target) throw new ApiError("not_found", 404);
  const [child] = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), eq(products.variantOf, id), isNull(products.archivedAt))).limit(1);
  if (child) throw new ApiError("has_variants", 409);
  return target.variantOf ?? target.id;
}

/** Packs are saved as a whole list each time, which keeps the form simple. */
async function savePacks(tx: Tx, storeId: string, productId: string, packs: Pack[]) {
  await tx.delete(productPacks).where(and(eq(productPacks.storeId, storeId), eq(productPacks.productId, productId)));
  if (packs.length) await tx.insert(productPacks).values(packs.map((p) => ({ storeId, productId, ...p })));
}

app.get("/v1/audit", ...managers, async (c) => {
  const store = c.get("store");
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const rows = await withStore(store.id, (tx) =>
    tx
      .select({ id: auditLog.id, action: auditLog.action, entityId: auditLog.entityId, detail: auditLog.detail, at: auditLog.at, actorName: users.name })
      .from(auditLog)
      .leftJoin(users, and(eq(users.storeId, auditLog.storeId), eq(users.id, auditLog.actorId)))
      .where(eq(auditLog.storeId, store.id))
      .orderBy(desc(auditLog.at))
      .limit(51)
      .offset((page - 1) * 50),
  );
  return c.json({ entries: rows.slice(0, 50).map((r) => ({ ...r, at: r.at.toISOString() })), hasMore: rows.length > 50 });
});

// One bad row shouldn't lose the rest, so each row gets its own savepoint and result.
app.post("/v1/products/import", async (c) => {
  const store = c.get("store");
  const body = importRowsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const results: { index: number; status: "created" | "rejected"; reason?: string }[] = [];
  await withStore(store.id, async (tx) => {
    for (const [index, raw] of body.data.rows.entries()) {
      const input = productCreateSchema.safeParse(raw);
      if (!input.success) {
        results.push({ index, status: "rejected", reason: input.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const id = randomUUID();
      try {
        await tx.transaction(async (row) => {
          await row.insert(products).values({ storeId: store.id, id, sku: `P-${id.slice(0, 8).toUpperCase()}`, ...fields(input.data) });
          if (input.data.openingStock > 0) {
            await row.insert(stockLedger).values({ storeId: store.id, branchId: c.get("device").branchId, productId: id, qtyDelta: input.data.openingStock, reason: "opening", actorId: c.get("user").id });
          }
        });
        results.push({ index, status: "created" });
      } catch (e) {
        if (pgCode(e) !== UNIQUE_VIOLATION) throw e;
        results.push({ index, status: "rejected", reason: "duplicate_barcode" });
      }
    }
    await audit(tx, store.id, c.get("user").id, "product_import", null, { created: results.filter((r) => r.status === "created").length, rejected: results.filter((r) => r.status === "rejected").length });
  });
  return c.json({ results });
});

app.post("/v1/products", async (c) => {
  const store = c.get("store");
  const input = productCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? "invalid" }, 400);
  const id = randomUUID();
  try {
    await withStore(store.id, async (tx) => {
      const variantOf = await resolveVariantOf(tx, store.id, id, input.data.variantOf);
      await tx.insert(products).values({ storeId: store.id, id, sku: `P-${id.slice(0, 8).toUpperCase()}`, ...fields(input.data), variantOf });
      await savePacks(tx, store.id, id, input.data.packs);
      await audit(tx, store.id, c.get("user").id, "product_create", id, { name: input.data.nameEn || input.data.nameBn });
      if (input.data.openingStock > 0) {
        await tx.insert(stockLedger).values({ storeId: store.id, branchId: c.get("device").branchId, productId: id, qtyDelta: input.data.openingStock, reason: "opening", actorId: c.get("user").id });
      }
    });
  } catch (e) {
    if (e instanceof ApiError) return c.json({ error: e.code }, e.status);
    const error = duplicateError(e);
    if (error) return c.json({ error }, 409);
    throw e;
  }
  return c.json({ id }, 201);
});

const activeProduct = (storeId: string, id: string) =>
  and(eq(products.storeId, storeId), eq(products.id, id), isNull(products.archivedAt));

app.get("/v1/products/:id", async (c) => {
  const store = c.get("store");
  const id = uuidParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "not_found" }, 404);
  const [row] = await withStore(store.id, (tx) =>
    tx
      .select({
        id: products.id, sku: products.sku, barcode: products.barcode, nameEn: products.nameEn, nameBn: products.nameBn,
        category: products.category, pricePoisha: products.pricePoisha, costPoisha: products.costPoisha, imageUrl: products.imageUrl, unit: products.unit, vatRateBp: products.vatRateBp,
        variantOf: products.variantOf, variantName: products.variantName,
      })
      .from(products)
      .where(activeProduct(store.id, id.data)),
  );
  if (!row) return c.json({ error: "not_found" }, 404);
  const packs = await withStore(store.id, (tx) =>
    tx.select({ id: productPacks.id, name: productPacks.name, qty: productPacks.qty, pricePoisha: productPacks.pricePoisha, barcode: productPacks.barcode }).from(productPacks).where(and(eq(productPacks.storeId, store.id), eq(productPacks.productId, id.data))),
  );
  return c.json({ ...row, packs });
});

app.patch("/v1/products/:id", async (c) => {
  const store = c.get("store");
  const id = uuidParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "not_found" }, 404);
  const input = productUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? "invalid" }, 400);
  try {
    const found = await withStore(store.id, async (tx) => {
      const variantOf = await resolveVariantOf(tx, store.id, id.data, input.data.variantOf);
      const updated = await tx.update(products).set({ ...fields(input.data), variantOf }).where(activeProduct(store.id, id.data)).returning({ id: products.id });
      if (updated.length === 0) return false;
      await savePacks(tx, store.id, id.data, input.data.packs);
      await audit(tx, store.id, c.get("user").id, "product_update", id.data, { name: input.data.nameEn || input.data.nameBn, pricePoisha: input.data.pricePoisha, costPoisha: input.data.costPoisha, stockAdjustment: input.data.stockAdjustment });
      if (input.data.stockAdjustment !== 0) {
        await tx.insert(stockLedger).values({ storeId: store.id, branchId: c.get("device").branchId, productId: id.data, qtyDelta: input.data.stockAdjustment, reason: "adjustment", actorId: c.get("user").id });
      }
      return true;
    });
    return found ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof ApiError) return c.json({ error: e.code }, e.status);
    const error = duplicateError(e);
    if (error) return c.json({ error }, 409);
    throw e;
  }
});

/** Archived, never deleted: past sales must keep pointing at the product. */
app.delete("/v1/products/:id", async (c) => {
  const store = c.get("store");
  const id = uuidParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "not_found" }, 404);
  const updated = await withStore(store.id, async (tx) => {
    const rows = await tx.update(products).set({ archivedAt: new Date() }).where(activeProduct(store.id, id.data)).returning({ id: products.id });
    if (rows.length) await audit(tx, store.id, c.get("user").id, "product_remove", id.data);
    return rows;
  });
  return updated.length ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/** Checks the file's actual bytes, not its claimed type. SVG is refused because it can carry scripts. */
function imageExtension(b: Buffer) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

const imagesRoot = fileURLToPath(new URL("../public/products/", import.meta.url));

app.put("/v1/products/:id/image", async (c) => {
  const store = c.get("store");
  const id = uuidParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "not_found" }, 404);
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return c.json({ error: "image_too_large" }, 413);
  const ext = imageExtension(bytes);
  if (!ext) return c.json({ error: "invalid_image" }, 415);

  // Every upload gets a new name, so devices holding the old picture fetch the new one.
  const fileName = `${randomUUID()}.${ext}`;
  const storeDir = join(imagesRoot, store.id);
  await mkdir(storeDir, { recursive: true });
  await writeFile(join(storeDir, fileName), bytes);
  const imageUrl = `/products/${store.id}/${fileName}`;

  let previous: string | null | undefined;
  try {
    previous = await withStore(store.id, async (tx) => {
      const [row] = await tx.select({ imageUrl: products.imageUrl }).from(products).where(activeProduct(store.id, id.data));
      if (!row) return undefined;
      await tx.update(products).set({ imageUrl }).where(activeProduct(store.id, id.data));
      await audit(tx, store.id, c.get("user").id, "product_photo", id.data);
      return row.imageUrl;
    });
  } catch (e) {
    await rm(join(storeDir, fileName), { force: true });
    throw e;
  }
  if (previous === undefined) {
    await rm(join(storeDir, fileName), { force: true });
    return c.json({ error: "not_found" }, 404);
  }
  // Shared sample pictures sit outside the store's folder and are left alone.
  if (previous?.startsWith(`/products/${store.id}/`)) {
    await rm(join(storeDir, basename(previous)), { force: true });
  }
  return c.json({ imageUrl });
});

const FOREIGN_KEY_VIOLATION = "23503";
app.post("/v1/sync/sales", async (c) => {
  const store = c.get("store");
  const body = syncRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const results: SyncResult[] = [];
  for (const raw of body.data.sales) {
    const parsed = saleSchema.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { id?: unknown } | null)?.id;
      results.push({
        id: typeof id === "string" ? id : null,
        status: "rejected",
        reason: parsed.error.issues[0]?.message ?? "invalid_sale",
      });
      continue;
    }
    const sale = parsed.data;
    try {
      await withStore(store.id, async (tx) => {
        const inserted = await tx
          .insert(sales)
          .values({
            storeId: store.id,
            id: sale.id,
            cashierId: sale.cashierId,
            customerId: sale.customerId,
            deviceId: sale.deviceId,
            receiptNo: sale.receiptNo,
            soldAt: new Date(sale.soldAt),
            discountPoisha: sale.discountPoisha,
            totalPoisha: sale.totalPoisha,
            paymentMethod: sale.paymentMethod,
            tenderedPoisha: sale.tenderedPoisha,
            paymentRef: sale.paymentRef,
            bakiPaidMethod: sale.bakiPaidMethod,
            branchId: c.get("device").branchId,
            vatInclusive: sale.vatInclusive,
            vatPoisha: sale.vatPoisha,
          })
          .onConflictDoNothing()
          .returning({ id: sales.id });
        if (inserted.length === 0) return; // Already received: a retry must not deduct stock twice.

        const costRows = await tx
          .select({ id: products.id, costPoisha: products.costPoisha })
          .from(products)
          .where(and(eq(products.storeId, store.id), inArray(products.id, sale.lines.map((l) => l.productId))));
        const costs = new Map(costRows.map((p) => [p.id, p.costPoisha]));
        const bill = computeBill(sale.lines, sale.discountPoisha, sale.vatInclusive);
        await tx.insert(saleLines).values(
          sale.lines.map((l, i) => ({
            storeId: store.id,
            saleId: sale.id,
            lineNo: i + 1,
            productId: l.productId,
            name: l.name,
            qty: l.qty,
            unitPricePoisha: l.unitPricePoisha,
            // Cost of one sold item: a dozen costs twelve pieces' worth.
            costPoisha: Math.round(((costs.get(l.productId) ?? 0) * l.packQty) / QTY_SCALE),
            packQty: l.packQty,
            packName: l.packName,
            vatRateBp: l.vatRateBp,
            vatPoisha: bill.lines[i].vatPoisha,
            finalPoisha: bill.lines[i].finalPoisha,
          })),
        );
        // Stock may go negative: the sale really happened, so the shortfall is shown, not refused.
        await tx.insert(stockLedger).values(
          sale.lines.map((l) => ({
            storeId: store.id,
            branchId: c.get("device").branchId,
            productId: l.productId,
            qtyDelta: -Math.round((l.qty * l.packQty) / QTY_SCALE),
            reason: "sale" as const,
            refId: sale.id,
            actorId: sale.cashierId,
            occurredAt: new Date(sale.soldAt),
          })),
        );
      });
      results.push({ id: sale.id, status: "accepted" });
    } catch (e) {
      if (pgCode(e) !== FOREIGN_KEY_VIOLATION) throw e; // Anything else is temporary, so the POS retries.
      results.push({ id: sale.id, status: "rejected", reason: "unknown_reference" });
    }
  }
  return c.json({ results });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error" }, 500);
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) =>
  console.log(`API listening on http://${config.host}:${port}`),
);
