import type { CatalogResponse, CustomerSummary, OpKind, RecentSale, SyncResult } from "@lalcha/domain";
import { apiFetch, getAuth, refreshStaff } from "./session";
import { applyOpResults, applySyncResults, getMeta, nextOps, nextPendingBatch, queueCounts, saveCatalog, saveCustomers, saveRecentSales } from "./local";

export type SyncState = { online: boolean; pending: number; rejected: number; catalogVersion: number };

let state: SyncState = { online: true, pending: 0, rejected: 0, catalogVersion: 0 };
const listeners = new Set<() => void>();

function update(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getSyncState = () => state;
export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Keeps pictures on the device so products still show them with no internet. */
async function cacheImages(catalog: CatalogResponse) {
  if (!("caches" in self)) return;
  const cache = await caches.open("lalcha-images-v1");
  const urls = catalog.products.flatMap((p) => (p.imageUrl ? [p.imageUrl] : []));
  await Promise.allSettled(urls.map(async (u) => (await cache.match(u)) ?? cache.add(u)));
  // Replaced or removed pictures would otherwise use up the device's storage forever.
  const current = new Set(urls);
  for (const key of await cache.keys()) {
    if (!current.has(new URL(key.url).pathname)) await cache.delete(key);
  }
}

async function pushSales() {
  for (let batch = await nextPendingBatch(50); batch.length > 0; batch = await nextPendingBatch(50)) {
    const res = await apiFetch("/v1/sync/sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sales: batch }),
    });
    if (!res.ok) throw new Error(`sync ${res.status}`);
    await applySyncResults(((await res.json()) as { results: SyncResult[] }).results);
    update(await queueCounts());
  }
}

async function pushOps(kinds: OpKind[]) {
  for (let ops = await nextOps(kinds, 50); ops.length > 0; ops = await nextOps(kinds, 50)) {
    const res = await apiFetch("/v1/sync/ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) });
    if (!res.ok) throw new Error(`ops ${res.status}`);
    await applyOpResults(((await res.json()) as { results: SyncResult[] }).results);
    update(await queueCounts());
  }
}

async function pullRecentSales() {
  const since = (await getMeta("recent_since")) ?? "";
  const res = await apiFetch(`/v1/sync/recent-sales?since=${encodeURIComponent(since)}`);
  if (!res.ok) throw new Error(`recent ${res.status}`);
  const body = (await res.json()) as { sales: RecentSale[]; serverTime: string };
  await saveRecentSales(body.sales, body.serverTime);
}

async function pullCatalog() {
  const res = await apiFetch("/v1/catalog");
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const catalog = (await res.json()) as CatalogResponse;
  await saveCatalog(catalog);
  await pullRecentSales();
  await refreshStaff();
  const customerRes = await apiFetch("/v1/customers");
  if (customerRes.ok) await saveCustomers(((await customerRes.json()) as { customers: CustomerSummary[] }).customers);
  await cacheImages(catalog);
  update({ catalogVersion: state.catalogVersion + 1 });
}

let running: Promise<void> | null = null;

/** Sales go up before the catalogue comes down, so returned stock already includes them. */
export function syncNow() {
  running ??= (async () => {
    if (getAuth().status !== "paired") {
      running = null;
      return;
    }
    try {
      // Customers go first and returns last, because sales and returns refer to them in that order.
      await pushOps(["customer_create", "customer_update"]);
      await pushSales();
      await pushOps(["customer_payment", "sale_return", "shift_open", "shift_close"]);
      await pullCatalog();
      update({ online: true });
    } catch {
      update({ online: false });
    } finally {
      update(await queueCounts());
      running = null;
    }
  })();
  return running;
}

/** Waits out any sync already running, so the catalogue returned includes changes just saved. */
export async function syncFresh() {
  if (running) await running;
  await syncNow();
}

let started = false;

/** Runs from the moment a device is connected, so a locked till still uploads its sales. */
export function startSync() {
  if (started) return;
  started = true;
  void syncNow();
  window.addEventListener("online", () => void syncNow());
  window.setInterval(() => void syncNow(), 15_000);
}

export async function refreshQueueCounts() {
  update(await queueCounts());
}
