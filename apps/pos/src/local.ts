import { DEFAULT_SETTINGS, type CatalogProduct, type CatalogResponse, type CustomerSummary, type Role, type Sale, type StaffMember, type StoreSettings, type SubscriptionInfo, type Unit, type OpKind, type RecentSale, type ReportResponse, type SyncResult, lineAmount, QTY_SCALE } from "@lalcha/domain";
import { v7 as uuidv7 } from "uuid";
import type { Statement } from "./db.worker";

type Row = Record<string, string | number | null>;

const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
const waiting = new Map<number, { resolve: (r: Row[][]) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<{ id: number; results?: Row[][]; error?: string }>) => {
  const w = waiting.get(e.data.id);
  if (!w) return;
  waiting.delete(e.data.id);
  if (e.data.error) w.reject(new Error(e.data.error));
  else w.resolve(e.data.results!);
};

/** Runs the statements together in one transaction: all of them apply, or none do. */
function run(statements: Statement[]) {
  return new Promise<Row[][]>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, statements });
  });
}

/** Stock shown is the server's figure minus sales the server hasn't received yet. */
export async function loadProducts(): Promise<CatalogProduct[]> {
  const [rows, pending] = await run([
    { sql: "SELECT * FROM products ORDER BY category, name_en" },
    { sql: "SELECT payload FROM sale_queue WHERE status = 'pending'" },
  ]);
  const sold = new Map<string, number>();
  for (const { payload } of pending) {
    for (const l of (JSON.parse(payload as string) as Sale).lines) {
      sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    sku: r.sku as string,
    barcode: r.barcode as string | null,
    nameEn: r.name_en as string,
    nameBn: r.name_bn as string,
    category: r.category as string,
    pricePoisha: r.price_poisha as number,
    imageUrl: r.image_url as string | null,
    unit: r.unit as Unit,
    stock: (r.stock as number) - (sold.get(r.id as string) ?? 0),
  }));
}

export async function saveCatalog(catalog: CatalogResponse) {
  await run([
    { sql: "DELETE FROM products" },
    ...catalog.products.map((p) => ({
      sql: "INSERT INTO products (id, sku, barcode, name_en, name_bn, category, price_poisha, image_url, stock, unit) VALUES (?,?,?,?,?,?,?,?,?,?)",
      bind: [p.id, p.sku, p.barcode, p.nameEn, p.nameBn, p.category, p.pricePoisha, p.imageUrl, p.stock, p.unit],
    })),
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('store_name', ?)", bind: [catalog.store.name] },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('settings', ?)", bind: [JSON.stringify(catalog.settings)] },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('subscription', ?)", bind: [JSON.stringify(catalog.subscription)] },
  ]);
}

export async function getMeta(k: string) {
  const [rows] = await run([{ sql: "SELECT v FROM meta WHERE k = ?", bind: [k] }]);
  return (rows[0]?.v as string | undefined) ?? null;
}
export async function setMeta(k: string, v: string) {
  await run([{ sql: "INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", bind: [k, v] }]);
}
export async function deleteMeta(k: string) {
  await run([{ sql: "DELETE FROM meta WHERE k = ?", bind: [k] }]);
}

export async function saveStaff(staff: StaffMember[]) {
  const ids = staff.map((s) => s.id);
  await run([
    { sql: "DELETE FROM staff" },
    ...staff.map((s) => ({ sql: "INSERT INTO staff (id, name, role) VALUES (?,?,?)", bind: [s.id, s.name, s.role] })),
    { sql: `DELETE FROM staff_pins WHERE user_id NOT IN (${ids.map(() => "?").join(",")})`, bind: ids },
  ]);
}

export async function loadStaff(): Promise<StaffMember[]> {
  const [rows] = await run([{ sql: "SELECT id, name, role FROM staff ORDER BY name" }]);
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, role: r.role as Role }));
}

export async function savePinVerifier(userId: string, salt: string, hash: string, iterations: number) {
  await run([
    { sql: "INSERT OR REPLACE INTO staff_pins (user_id, salt, hash, iterations, failed, locked_until) VALUES (?,?,?,?,0,0)", bind: [userId, salt, hash, iterations] },
  ]);
}

export async function getPinVerifier(userId: string) {
  const [rows] = await run([{ sql: "SELECT * FROM staff_pins WHERE user_id = ?", bind: [userId] }]);
  const r = rows[0];
  return r
    ? { salt: r.salt as string, hash: r.hash as string, iterations: r.iterations as number, failed: r.failed as number, lockedUntil: r.locked_until as number }
    : null;
}

export async function recordPinResult(userId: string, failed: number, lockedUntil: number) {
  await run([{ sql: "UPDATE staff_pins SET failed = ?, locked_until = ? WHERE user_id = ?", bind: [failed, lockedUntil, userId] }]);
}

export async function loadSettings(): Promise<StoreSettings> {
  const value = await getMeta("settings");
  return value ? (JSON.parse(value) as StoreSettings) : DEFAULT_SETTINGS;
}

export async function loadSubscription() {
  const value = await getMeta("subscription");
  return value ? (JSON.parse(value) as SubscriptionInfo | null) : null;
}

export async function saveCustomers(customers: CustomerSummary[]) {
  await run([
    { sql: "DELETE FROM customers" },
    ...customers.map((c) => ({
      sql: "INSERT INTO customers (id, name, phone, address, due_poisha, credit_limit_poisha) VALUES (?,?,?,?,?,?)",
      bind: [c.id, c.name, c.phone, c.address, c.duePoisha, c.creditLimitPoisha],
    })),
  ]);
}

/** Baki shown is the server's figure plus credit sales it hasn't received yet. */
export async function loadCustomers(): Promise<CustomerSummary[]> {
  const [rows, pending, ops] = await run([
    { sql: "SELECT * FROM customers ORDER BY name" },
    { sql: "SELECT payload FROM sale_queue WHERE status = 'pending'" },
    { sql: "SELECT kind, payload FROM outbox WHERE status = 'pending' AND kind IN ('customer_payment', 'sale_return')" },
  ]);
  const extra = new Map<string, number>();
  const salesById = new Map((await loadLocalSales()).map((s) => [s.id, s]));
  for (const op of ops) {
    const p = JSON.parse(op.payload as string) as { customerId?: string; amountPoisha?: number; saleId?: string; creditPoisha?: number };
    const id = op.kind === "customer_payment" ? p.customerId : salesById.get(p.saleId ?? "")?.customerId;
    const amount = op.kind === "customer_payment" ? (p.amountPoisha ?? 0) : (p.creditPoisha ?? 0);
    if (id) extra.set(id, (extra.get(id) ?? 0) - amount);
  }
  for (const { payload } of pending) {
    const sale = JSON.parse(payload as string) as Sale;
    if (sale.paymentMethod === "baki" && sale.customerId) {
      extra.set(sale.customerId, (extra.get(sale.customerId) ?? 0) + sale.totalPoisha - sale.tenderedPoisha);
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    phone: r.phone as string | null,
    address: r.address as string | null,
    duePoisha: (r.due_poisha as number) + (extra.get(r.id as string) ?? 0),
    creditLimitPoisha: r.credit_limit_poisha as number | null,
  }));
}

export async function getStoreName() {
  const [rows] = await run([{ sql: "SELECT v FROM meta WHERE k = 'store_name'" }]);
  return (rows[0]?.v as string | undefined) ?? "";
}

/** Reads and creates the device's identity and next receipt number. */
async function deviceAndReceipt() {
  const [rows] = await run([{ sql: "SELECT k, v FROM meta WHERE k IN ('device_id', 'receipt_seq')" }]);
  const meta = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  const deviceId = (meta.device_id as string | undefined) ?? uuidv7();
  const seq = Number(meta.receipt_seq ?? 0) + 1;
  const receiptNo = `${deviceId.slice(-4).toUpperCase()}-${String(seq).padStart(6, "0")}`;
  return { deviceId, seq, receiptNo };
}

export async function recordSale(input: Omit<Sale, "id" | "deviceId" | "receiptNo" | "soldAt">): Promise<Sale> {
  const { deviceId, seq, receiptNo } = await deviceAndReceipt();
  const soldAt = new Date().toISOString();
  const sale: Sale = { ...input, id: uuidv7(), deviceId, receiptNo, soldAt };
  await run([
    { sql: "INSERT INTO sale_queue (id, payload, created_at) VALUES (?,?,?)", bind: [sale.id, JSON.stringify(sale), soldAt] },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('device_id', ?), ('receipt_seq', ?)", bind: [deviceId, String(seq)] },
  ]);
  return sale;
}

export async function nextPendingBatch(limit: number): Promise<Sale[]> {
  const [rows] = await run([
    { sql: "SELECT payload FROM sale_queue WHERE status = 'pending' ORDER BY created_at LIMIT ?", bind: [limit] },
  ]);
  return rows.map((r) => JSON.parse(r.payload as string) as Sale);
}

export async function applySyncResults(results: { id: string | null; status: string; reason?: string }[]) {
  await run(
    results
      .filter((r) => r.id)
      .map((r) => ({
        sql: "UPDATE sale_queue SET status = ?, error = ? WHERE id = ?",
        bind: [r.status === "accepted" ? "synced" : "rejected", r.reason ?? null, r.id],
      })),
  );
}

/** Saves work on the device first. The sync loop delivers it whenever the connection allows. */
export async function enqueueOp(kind: OpKind, id: string, actorId: string, payload: unknown) {
  await run([{ sql: "INSERT OR IGNORE INTO outbox (id, kind, actor_id, payload, created_at) VALUES (?,?,?,?,?)", bind: [id, kind, actorId, JSON.stringify(payload), new Date().toISOString()] }]);
}

export async function addLocalCustomer(c: CustomerSummary, actorId: string) {
  await run([
    { sql: "INSERT OR REPLACE INTO customers (id, name, phone, address, due_poisha, credit_limit_poisha) VALUES (?,?,?,?,0,?)", bind: [c.id, c.name, c.phone, c.address, c.creditLimitPoisha] },
    { sql: "INSERT OR IGNORE INTO outbox (id, kind, actor_id, payload, created_at) VALUES (?,?,?,?,?)", bind: [c.id, "customer_create", actorId, JSON.stringify({ id: c.id, name: c.name, phone: c.phone, address: c.address, creditLimitPoisha: c.creditLimitPoisha }), new Date().toISOString()] },
  ]);
}

export async function nextOps(kinds: OpKind[], limit: number) {
  const [rows] = await run([
    { sql: `SELECT id, kind, actor_id, payload FROM outbox WHERE status = 'pending' AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY created_at LIMIT ?`, bind: [...kinds, limit] },
  ]);
  return rows.map((r) => ({ id: r.id as string, kind: r.kind as OpKind, actorId: r.actor_id as string, payload: JSON.parse(r.payload as string) as unknown }));
}

export async function applyOpResults(results: SyncResult[]) {
  await run(results.map((r) => ({ sql: "UPDATE outbox SET status = ?, error = ? WHERE id = ?", bind: [r.status === "accepted" ? "synced" : "rejected", r.reason ?? null, r.id] })));
}

export async function saveRecentSales(list: RecentSale[], serverTime: string) {
  await run([
    ...list.map((s) => ({ sql: "INSERT OR REPLACE INTO recent_sales (id, sold_at, payload) VALUES (?,?,?)", bind: [s.id, s.soldAt, JSON.stringify(s)] })),
    { sql: "DELETE FROM recent_sales WHERE sold_at < ?", bind: [new Date(Date.now() - 45 * 86_400_000).toISOString()] },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('recent_since', ?)", bind: [serverTime] },
  ]);
}

export type LocalSale = RecentSale;

/** Recent sales from the server, this till's unsent sales, and returns not yet delivered. */
export async function loadLocalSales(): Promise<LocalSale[]> {
  const [recent, queued, ops] = await run([
    { sql: "SELECT payload FROM recent_sales" },
    { sql: "SELECT payload FROM sale_queue WHERE status IN ('pending', 'synced') ORDER BY created_at DESC LIMIT 2000" },
    { sql: "SELECT payload FROM outbox WHERE status = 'pending' AND kind = 'sale_return'" },
  ]);
  const all = new Map<string, LocalSale>();
  for (const r of queued) {
    const s = JSON.parse(r.payload as string) as Sale;
    all.set(s.id, {
      id: s.id, receiptNo: s.receiptNo, soldAt: s.soldAt, totalPoisha: s.totalPoisha, tenderedPoisha: s.tenderedPoisha, discountPoisha: s.discountPoisha, vatPoisha: s.vatPoisha ?? 0,
      paymentMethod: s.paymentMethod, bakiPaidMethod: s.bakiPaidMethod ?? "cash", customerId: s.customerId, cashierName: null, returnedPoisha: 0, creditedPoisha: 0,
      lines: s.lines.map((l, i) => ({ lineNo: i + 1, productId: l.productId, name: l.name, qty: l.qty, unitPricePoisha: l.unitPricePoisha, unit: l.unit ?? "pc", returnedQty: 0 })),
    });
  }
  for (const r of recent) {
    const s = JSON.parse(r.payload as string) as LocalSale;
    all.set(s.id, s);
  }
  for (const op of ops) {
    const p = JSON.parse(op.payload as string) as { saleId: string; valuePoisha?: number; creditPoisha: number; lines: { lineNo: number; qty: number }[] };
    const sale = all.get(p.saleId);
    if (!sale) continue;
    all.set(p.saleId, {
      ...sale,
      returnedPoisha: sale.returnedPoisha + (p.valuePoisha ?? 0),
      creditedPoisha: sale.creditedPoisha + p.creditPoisha,
      lines: sale.lines.map((l) => ({ ...l, returnedQty: l.returnedQty + (p.lines.find((x) => x.lineNo === l.lineNo)?.qty ?? 0) })),
    });
  }
  return [...all.values()].sort((a, b) => b.soldAt.localeCompare(a.soldAt));
}

/** Sales figures this device can work out alone. Profit and stock value need the server. */
export async function buildLocalReport(from: string, to: string): Promise<ReportResponse> {
  const start = Date.parse(`${from}T00:00:00+06:00`);
  const end = Date.parse(`${to}T00:00:00+06:00`) + 86_400_000;
  const sales = (await loadLocalSales()).filter((s) => Date.parse(s.soldAt) >= start && Date.parse(s.soldAt) < end);
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const dayOf = (iso: string) => new Date(Date.parse(iso) + 6 * 3_600_000).toISOString().slice(0, 10);
  const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(start + i * 86_400_000 + 6 * 3_600_000).toISOString().slice(0, 10), netPoisha: 0, bills: 0 }));
  const top = new Map<string, ReportResponse["topProducts"][number]>();
  const cashiers = new Map<string, { name: string; bills: number; salesPoisha: number }>();
  const paid = { cash: 0, bkash: 0, nagad: 0, card: 0 };
  const products = await loadProducts();
  let net = 0, returned = 0, discount = 0, baki = 0, vat = 0;
  for (const s of sales) {
    const value = s.totalPoisha - s.returnedPoisha;
    net += value;
    returned += s.returnedPoisha;
    discount += s.discountPoisha;
    vat += s.totalPoisha ? s.vatPoisha * (value / s.totalPoisha) : 0;
    const d = daily.find((x) => x.date === dayOf(s.soldAt));
    if (d) { d.netPoisha += value; d.bills += 1; }
    const method = (s.paymentMethod === "baki" ? s.bakiPaidMethod : s.paymentMethod) as keyof typeof paid;
    paid[method] += Math.min(s.tenderedPoisha, s.totalPoisha);
    if (s.paymentMethod === "baki") baki += s.totalPoisha - s.tenderedPoisha;
    const who = s.cashierName ?? "—";
    const c = cashiers.get(who) ?? { name: who, bills: 0, salesPoisha: 0 };
    c.bills += 1; c.salesPoisha += s.totalPoisha;
    cashiers.set(who, c);
    for (const l of s.lines) {
      const p = products.find((x) => x.id === l.productId);
      const row = top.get(l.productId) ?? { id: l.productId, nameEn: p?.nameEn ?? l.name, nameBn: p?.nameBn ?? l.name, imageUrl: p?.imageUrl ?? null, qty: 0, salesPoisha: 0, unit: l.unit };
      row.qty += l.qty; row.salesPoisha += lineAmount(l.qty, l.unitPricePoisha);
      top.set(l.productId, row);
    }
  }
  return {
    partial: true, netSalesPoisha: net, grossProfitPoisha: 0, bills: sales.length, discountPoisha: discount, returnsPoisha: returned, returnsCount: 0, bakiGivenPoisha: baki, bakiCollectedPoisha: 0, cashMovementPoisha: 0, vatPoisha: Math.round(vat),
    daily, payments: (["cash", "bkash", "nagad", "card"] as const).map((method) => ({ method, receivedPoisha: paid[method], refundedPoisha: 0 })),
    topProducts: [...top.values()].sort((a, b) => b.salesPoisha - a.salesPoisha).slice(0, 10), cashiers: [...cashiers.values()].sort((a, b) => b.salesPoisha - a.salesPoisha),
    lowStock: products.filter((p) => p.stock <= 5 * QTY_SCALE).slice(0, 20).map((p) => ({ id: p.id, nameEn: p.nameEn, nameBn: p.nameBn, imageUrl: p.imageUrl, costPoisha: 0, stock: p.stock, unit: p.unit })),
    stockValuePoisha: 0, bakiOutstandingPoisha: (await loadCustomers()).reduce((sum, c) => sum + Math.max(c.duePoisha, 0), 0), supplierOwedPoisha: 0,
  };
}

export type LocalShift = { id: string; openedAt: string; floatPoisha: number };
export async function loadShift(): Promise<LocalShift | null> {
  const value = await getMeta("shift");
  return value && value !== "null" ? (JSON.parse(value) as LocalShift) : null;
}
export async function saveShift(shift: LocalShift | null) {
  await setMeta("shift", JSON.stringify(shift));
}

/** Cash this till should hold: the float, cash taken since opening, minus cash handed back. */
export async function expectedCash(shift: LocalShift) {
  const [sales, ops] = await run([
    { sql: "SELECT payload FROM sale_queue WHERE created_at >= ? AND status <> 'rejected'", bind: [shift.openedAt] },
    { sql: "SELECT kind, payload FROM outbox WHERE created_at >= ? AND status <> 'rejected' AND kind IN ('customer_payment', 'sale_return')", bind: [shift.openedAt] },
  ]);
  let cash = shift.floatPoisha;
  for (const r of sales) {
    const s = JSON.parse(r.payload as string) as Sale;
    if (s.paymentMethod === "cash") cash += s.totalPoisha;
    if (s.paymentMethod === "baki" && (s.bakiPaidMethod ?? "cash") === "cash") cash += s.tenderedPoisha;
  }
  for (const r of ops) {
    const p = JSON.parse(r.payload as string) as { method?: string; amountPoisha?: number; refundMethod?: string; valuePoisha?: number; creditPoisha?: number };
    if (r.kind === "customer_payment" && p.method === "cash") cash += p.amountPoisha ?? 0;
    if (r.kind === "sale_return" && p.refundMethod === "cash") cash -= (p.valuePoisha ?? 0) - (p.creditPoisha ?? 0);
  }
  return cash;
}

export async function queueCounts() {
  const [rows, ops] = await run([
    { sql: "SELECT status, COUNT(*) AS n FROM sale_queue GROUP BY status" },
    { sql: "SELECT status, COUNT(*) AS n FROM outbox GROUP BY status" },
  ]);
  const counts: Record<string, number> = {};
  for (const r of [...rows, ...ops]) counts[r.status as string] = (counts[r.status as string] ?? 0) + Number(r.n);
  return { pending: counts.pending ?? 0, rejected: counts.rejected ?? 0 };
}
