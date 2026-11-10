import {
  computeTotals,
  formatQty,
  lineAmount,
  QTY_SCALE,
  formatTaka,
  SUPPLIER_PAYMENT_METHODS,
  type CatalogProduct,
  type Lang,
  type PurchaseDetail,
  type PurchaseSummary,
  type SupplierDetail,
  type SupplierPaymentMethod,
  type SupplierSummary,
} from "@lalcha/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { name, ProductImage } from "./ProductImage";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const primary = "min-h-14 bg-[#12130f] px-4 text-xl font-black text-accent ring-2 ring-line disabled:opacity-40";
const secondary = "min-h-14 border-[3px] border-line px-4 text-lg font-black";
const addButton = "min-h-13 shrink-0 bg-accent px-4 text-lg font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40";
const API_ERRORS: StringKey[] = [
  "name_required", "invalid_phone", "duplicate_invoice", "exceeds_due", "paid_exceeds_total", "payment_ref_required", "supplier_has_due",
  "not_open", "unknown_supplier", "no_lines", "bad_date", "total_too_large", "insufficient_stock", "stock_already_used", "has_returns", "exceeds_sold", "exceeds_order",
];

const money = (text: string) => (text.trim() === "" ? 0 : Math.round(Number(text) * 100));
const digits = (v: string) => v.replace(/[^0-9.]/g, "");
const today = () => new Date().toLocaleDateString("en-CA");
const dateText = (iso: string, lang: Lang) => new Date(iso).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB");

async function send(path: string, method: string, body: unknown, t: T): Promise<string | null> {
  try {
    const res = await apiFetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    const code = data?.error as StringKey | undefined;
    return code && API_ERRORS.includes(code) ? t(code) : t("saveFailed");
  } catch {
    return t("saveFailed");
  }
}

function Dialog({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-full w-full space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4 ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <h2 className="text-2xl font-black">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PaymentFields({
  t, paid, setPaid, method, setMethod, reference, setReference, full, lang,
}: {
  t: T; paid: string; setPaid: (v: string) => void; method: SupplierPaymentMethod; setMethod: (m: SupplierPaymentMethod) => void;
  reference: string; setReference: (v: string) => void; full: number; lang: Lang;
}) {
  return (
    <div className="space-y-2">
      <label className="block font-bold">
        {t("paidNow")}
        <div className="flex gap-2">
          <input inputMode="decimal" value={paid} onChange={(e) => setPaid(digits(e.target.value))} placeholder="0" className={field} />
          <button type="button" className="mt-1 h-12 shrink-0 border-[3px] border-line px-3 font-black" onClick={() => setPaid(String(full / 100))}>
            {t("payFull")} {formatTaka(full, lang)}
          </button>
        </div>
      </label>
      <div className="grid grid-cols-4 gap-2">
        {SUPPLIER_PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line font-black ${method === m ? "bg-text text-bg" : ""}`}>
            {t(m)}
          </button>
        ))}
      </div>
      {method !== "cash" && (
        <label className="block font-bold">
          {t("ref")}
          <input maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
        </label>
      )}
    </div>
  );
}

export function PurchaseScreen({
  products, lang, t, online, onChanged,
}: { products: CatalogProduct[]; lang: Lang; t: T; online: boolean; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<"purchases" | "suppliers">("purchases");
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [openPurchase, setOpenPurchase] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState<{ supplier: SupplierSummary | null } | null>(null);
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  async function more() {
    const res = await apiFetch(`/v1/purchases?page=${page + 1}`);
    if (!res.ok) return;
    const next = (await res.json()) as { purchases: PurchaseSummary[]; hasMore: boolean };
    setPurchases((c) => [...c, ...next.purchases]);
    setHasMore(next.hasMore);
    setPage(page + 1);
  }

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([apiFetch("/v1/purchases"), apiFetch("/v1/suppliers")]);
      if (!p.ok || !s.ok) throw new Error();
      const firstPage = (await p.json()) as { purchases: PurchaseSummary[]; hasMore: boolean };
      setPurchases(firstPage.purchases);
      setHasMore(firstPage.hasMore);
      setPage(1);
      const list = ((await s.json()) as { suppliers: SupplierSummary[] }).suppliers;
      setSuppliers(list);
      setFailed(false);
      return list;
    } catch {
      setFailed(true);
      return [];
    }
  }, []);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const totalDue = suppliers.reduce((sum, s) => sum + Math.max(s.duePoisha, 0), 0);
  const afterStockChange = async () => {
    await Promise.all([load(), onChanged()]);
  };
  const statusKey = { ordered: "statusOrdered", received: "statusReceived", cancelled: "statusCancelled", voided: "statusVoided", partial: "statusPartial" } as const;

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="grid grid-cols-2 border-[3px] border-line font-black">
          {(["purchases", "suppliers"] as const).map((v) => (
            <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)} className={`min-h-12 ${tab === v ? "bg-text text-bg" : "bg-panel"}`}>
              {t(v)}
            </button>
          ))}
        </div>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {failed && online && <p role="alert" className="font-bold text-hot">{t("saveFailed")}</p>}

        {tab === "purchases" ? (
          <>
            <button disabled={!online} onClick={() => setCreating(true)} className={`${addButton} w-full`}>
              + {t("newPurchase")}
            </button>
            {purchases.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noPurchases")}</p>}
            <ul className="space-y-2">
              {purchases.map((p) => (
                <li key={p.id}>
                  <button disabled={!online} onClick={() => setOpenPurchase(p.id)} className="flex min-h-16 w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-black">{p.supplierName}</span>
                      <span className="block text-sm font-bold text-muted">
                        {dateText(p.purchasedAt, lang)}{p.invoiceNo ? ` · ${p.invoiceNo}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xl font-black">{formatTaka(p.totalPoisha, lang)}</span>
                      <span className={`block text-sm font-bold ${p.status === "ordered" || p.status === "partial" ? "text-hot" : "text-muted"}`}>{t(statusKey[p.status])}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && <button className="min-h-12 w-full border-[3px] border-line font-black" onClick={() => void more()}>{t("loadMore")}</button>}
          </>
        ) : (
          <>
            <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
              <span className="text-lg font-black">{t("totalDue")}</span>
              <span className="text-4xl font-black" data-testid="total-due">{formatTaka(totalDue, lang)}</span>
            </div>
            <button disabled={!online} onClick={() => setSupplierForm({ supplier: null })} className={`${addButton} w-full`}>
              + {t("addSupplier")}
            </button>
            {suppliers.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noSuppliers")}</p>}
            <ul className="space-y-2">
              {suppliers.map((s) => (
                <li key={s.id}>
                  <button disabled={!online} onClick={() => setOpenSupplier(s.id)} className="flex min-h-16 w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-black">{s.name}</span>
                      <span className="block font-bold text-muted">{s.phone ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-xl font-black ${s.duePoisha > 0 ? "text-hot" : ""}`}>{formatTaka(Math.abs(s.duePoisha), lang)}</span>
                      <span className="block text-sm font-bold text-muted">{s.duePoisha < 0 ? t("advance") : t("due")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {creating && (
        <NewPurchase
          products={products} suppliers={suppliers} lang={lang} t={t} reloadSuppliers={load}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await afterStockChange();
          }}
        />
      )}
      {openPurchase && (
        <PurchaseView id={openPurchase} lang={lang} t={t} onClose={() => setOpenPurchase(null)} onChanged={async () => { setOpenPurchase(null); await afterStockChange(); }} />
      )}
      {supplierForm && (
        <SupplierForm supplier={supplierForm.supplier} t={t} onClose={() => setSupplierForm(null)} onSaved={async () => { setSupplierForm(null); await load(); }} />
      )}
      {openSupplier && (
        <SupplierView
          id={openSupplier} lang={lang} t={t}
          onClose={() => setOpenSupplier(null)}
          onEdit={(s) => { setOpenSupplier(null); setSupplierForm({ supplier: s }); }}
          onChanged={load}
        />
      )}
    </main>
  );
}

type Arrival = { batchNo: string; expiresOn: string; serials: string };
type Draft = { product: CatalogProduct; qty: string; cost: string } & Arrival;
const noArrival: Arrival = { batchNo: "", expiresOn: "", serials: "" };
const serialList = (text: string) => [...new Set(text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];
/** What goes to the server for a batch- or serial-tracked line, and whether it's complete. */
function arrivalPayload(tracking: string | undefined, a: Arrival, qty: number) {
  if (tracking === "batch") return { ok: Boolean(a.batchNo.trim()), fields: { batchNo: a.batchNo.trim() || null, expiresOn: a.expiresOn || null, serials: [] } };
  if (tracking === "serial") {
    const serials = serialList(a.serials);
    return { ok: serials.length * QTY_SCALE === qty, fields: { batchNo: null, expiresOn: null, serials } };
  }
  return { ok: true, fields: { batchNo: null, expiresOn: null, serials: [] } };
}

/** Batch number and expiry, or one serial per piece, for goods arriving now. */
function ArrivalFields({ tracking, value, t, onChange }: { tracking: string | undefined; value: Arrival; t: T; onChange: (a: Arrival) => void }) {
  if (tracking === "batch") {
    return (
      <div className="grid w-full grid-cols-2 gap-2">
        <label className="text-sm font-bold">{t("batchNo")}<input maxLength={60} value={value.batchNo} onChange={(e) => onChange({ ...value, batchNo: e.target.value })} className={field} /></label>
        <label className="text-sm font-bold">{t("expiryDate")}<input type="date" value={value.expiresOn} onChange={(e) => onChange({ ...value, expiresOn: e.target.value })} className={field} /></label>
      </div>
    );
  }
  if (tracking === "serial") {
    return (
      <label className="block w-full text-sm font-bold">
        {t("serialNumbers")} · {t("serialsHelp")}
        <textarea rows={3} value={value.serials} onChange={(e) => onChange({ ...value, serials: e.target.value })} onKeyDown={(e) => e.stopPropagation()} className="mt-1 w-full border-[3px] border-line bg-bg px-3 py-2 font-mono font-bold" />
      </label>
    );
  }
  return null;
}

function NewPurchase({
  products, suppliers, lang, t, reloadSuppliers, onClose, onSaved,
}: {
  products: CatalogProduct[]; suppliers: SupplierSummary[]; lang: Lang; t: T;
  reloadSuppliers: () => Promise<SupplierSummary[]>; onClose: () => void; onSaved: () => Promise<void>;
}) {
  // The same ID is sent on every retry, so a lost connection can't record the purchase twice.
  const id = useRef(uuidv7());
  const [supplierId, setSupplierId] = useState("");
  const [quickSupplier, setQuickSupplier] = useState<string | null>(suppliers.length === 0 ? "" : null);
  const [invoice, setInvoice] = useState("");
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [discount, setDiscount] = useState("");
  const [receiveNow, setReceiveNow] = useState(true);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<SupplierPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch("/v1/products/costs")
      .then((r) => (r.ok ? r.json() : { costs: [] }))
      .then((b: { costs: { id: string; costPoisha: number }[] }) => setCosts(new Map(b.costs.map((c) => [c.id, c.costPoisha]))))
      .catch(() => undefined);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => [p.nameEn, p.nameBn, p.sku, p.barcode ?? ""].some((v) => v.toLowerCase().includes(q))).slice(0, 6);
  }, [products, query]);

  function addLine(product: CatalogProduct) {
    setLines((current) => {
      const found = current.find((l) => l.product.id === product.id);
      if (found) return current.map((l) => (l === found ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l));
      return [{ product, qty: "1", cost: String((costs.get(product.id) ?? 0) / 100), ...noArrival }, ...current];
    });
    setQuery("");
  }

  function onSearchEnter() {
    const code = query.trim().toLowerCase();
    const exact = products.find((p) => p.barcode?.toLowerCase() === code || p.sku.toLowerCase() === code);
    if (exact) addLine(exact);
    else if (matches.length === 1) addLine(matches[0]);
  }

  const update = (pid: string, patch: Partial<Draft>) => setLines((c) => c.map((l) => (l.product.id === pid ? { ...l, ...patch } : l)));
  // A serial-tracked line counts its serials, so the quantity always matches what was scanned.
  const qtyOf = (l: Draft) => (receiveNow && l.product.tracking === "serial" && serialList(l.serials).length ? serialList(l.serials).length * QTY_SCALE : Math.round(Number(l.qty || 0) * QTY_SCALE));
  const payload = lines.map((l) => ({ productId: l.product.id, qty: qtyOf(l), unitCostPoisha: money(l.cost), ...(receiveNow ? arrivalPayload(l.product.tracking, l, qtyOf(l)).fields : {}) }));
  const arrivalsOk = !receiveNow || lines.every((l) => arrivalPayload(l.product.tracking, l, qtyOf(l)).ok);
  const totals = computeTotals(payload.map((l) => ({ qty: l.qty, unitPricePoisha: l.unitCostPoisha })), money(discount));
  const validLines = lines.length > 0 && payload.every((l) => Number.isInteger(l.qty) && l.qty > 0 && Number.isFinite(l.unitCostPoisha));
  const paidPoisha = money(paid);

  async function createSupplier() {
    if (!quickSupplier?.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/v1/suppliers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: quickSupplier.trim(), phone: null, address: null }),
      });
      if (!res.ok) throw new Error();
      const { id: newId } = (await res.json()) as { id: string };
      await reloadSuppliers();
      setSupplierId(newId);
      setQuickSupplier(null);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    if (!supplierId) return setError(t("unknown_supplier"));
    if (!validLines) return setError(t("no_lines"));
    if (!arrivalsOk) return setError(lines.some((l) => l.product.tracking === "serial") ? t("serialCountMismatch") : t("batchRequired"));
    setBusy(true);
    setError("");
    const failure = await send("/v1/purchases", "POST", {
      id: id.current,
      supplierId,
      invoiceNo: invoice.trim() || null,
      purchasedAt: new Date(`${date}T12:00:00+06:00`).toISOString(),
      discountPoisha: totals.discountPoisha,
      lines: payload,
      receiveNow,
      paidPoisha,
      paymentMethod: method,
      paymentRef: reference.trim() || null,
    }, t);
    setBusy(false);
    if (failure) setError(failure);
    else await onSaved();
  }

  return (
    <Dialog title={t("newPurchase")} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block font-bold sm:col-span-3">
          {t("supplier")}
          {quickSupplier === null ? (
            <div className="flex gap-2">
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={field}>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" aria-label={t("addSupplier")} className="mt-1 h-12 w-14 shrink-0 border-[3px] border-line text-xl font-black" onClick={() => setQuickSupplier("")}>+</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input autoFocus maxLength={120} value={quickSupplier} onChange={(e) => setQuickSupplier(e.target.value)} placeholder={t("supplierName")} className={field} />
              <button type="button" disabled={busy} className="mt-1 h-12 shrink-0 border-[3px] border-line px-4 font-black" onClick={() => void createSupplier()}>{t("save")}</button>
              {suppliers.length > 0 && <button type="button" aria-label={t("cancel")} className="mt-1 h-12 w-12 shrink-0 border-[3px] border-line font-black" onClick={() => setQuickSupplier(null)}>✕</button>}
            </div>
          )}
        </label>
        <label className="block font-bold">
          {t("invoiceNo")}
          <input maxLength={60} value={invoice} onChange={(e) => setInvoice(e.target.value)} className={field} />
        </label>
        <label className="block font-bold">
          {t("purchaseDate")}
          <input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearchEnter();
            }
          }}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold"
        />
        {matches.length > 0 && (
          <ul className="absolute inset-x-0 z-10 border-x-[3px] border-b-[3px] border-line bg-panel">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addLine(p)} className="flex min-h-14 w-full items-center gap-3 p-2 text-left font-bold">
                  <span className="relative h-11 w-11 shrink-0 bg-tile"><ProductImage product={p} lang={lang} /></span>
                  <span className="truncate">{name(p, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="space-y-2">
        {lines.length === 0 && <li className="p-5 text-center font-bold text-muted">{t("no_lines")}</li>}
        {lines.map((l) => (
          <li key={l.product.id} className="flex flex-wrap items-end gap-2 border-2 border-line/30 p-2">
            <span className="relative h-12 w-12 shrink-0 bg-tile"><ProductImage product={l.product} lang={lang} /></span>
            <span className="min-w-32 flex-1 self-center truncate font-bold">{name(l.product, lang)}</span>
            <label className="w-20 text-sm font-bold">
              {t("qty")}
              <input inputMode="decimal" aria-label={`${t("qty")}: ${name(l.product, lang)}`} value={l.qty} onChange={(e) => update(l.product.id, { qty: digits(e.target.value) })} className={field} />
            </label>
            <label className="w-24 text-sm font-bold">
              {t("unitCost")}
              <input inputMode="decimal" aria-label={`${t("unitCost")}: ${name(l.product, lang)}`} value={l.cost} onChange={(e) => update(l.product.id, { cost: digits(e.target.value) })} className={field} />
            </label>
            <span className="w-24 self-center text-right font-black">{formatTaka(lineAmount(Math.round(Number(l.qty || 0) * QTY_SCALE), money(l.cost)), lang)}</span>
            <button type="button" aria-label={`${t("remove")}: ${name(l.product, lang)}`} className="h-12 w-12 border-2 border-line font-black" onClick={() => setLines((c) => c.filter((x) => x !== l))}>✕</button>
            {receiveNow && <ArrivalFields tracking={l.product.tracking} value={l} t={t} onChange={(a) => update(l.product.id, a)} />}
          </li>
        ))}
      </ul>

      <label className="flex items-center justify-between gap-3 font-bold">
        {t("discount")}
        <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(digits(e.target.value))} placeholder="0" className="h-12 w-36 border-[3px] border-line bg-bg px-3 text-right text-lg font-black" />
      </label>
      <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
        <span className="text-lg font-black">{t("total")}</span>
        <span data-testid="purchase-total" className="text-4xl font-black">{formatTaka(totals.totalPoisha, lang)}</span>
      </div>

      <label className="flex min-h-11 items-center gap-3 font-bold">
        <input type="checkbox" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} className="h-6 w-6" />
        {t("receiveNow")}
      </label>
      <>
          <PaymentFields t={t} lang={lang} paid={paid} setPaid={setPaid} method={method} setMethod={setMethod} reference={reference} setReference={setReference} full={totals.totalPoisha} />
          <div className="flex justify-between text-xl font-black">
            <span>{t("due")}</span>
            <span className={paidPoisha > totals.totalPoisha ? "text-hot" : ""}>{formatTaka(Math.max(totals.totalPoisha - paidPoisha, 0), lang)}</span>
          </div>
      </>
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={`${secondary} flex-1`} onClick={onClose}>{t("cancel")}</button>
        <button type="button" disabled={busy} className={`${primary} flex-[2]`} onClick={() => void save()}>{busy ? t("saving") : t("save")}</button>
      </div>
    </Dialog>
  );
}

function PurchaseView({ id, lang, t, onClose, onChanged }: { id: string; lang: Lang; t: T; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<SupplierPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [arriving, setArriving] = useState<Record<number, string>>({});
  const [arrivals, setArrivals] = useState<Record<number, Arrival>>({});
  const receiptId = useRef(uuidv7());
  const [confirmClose, setConfirmClose] = useState(false);
  const [back, setBack] = useState<Record<number, string>>({});
  const returnId = useRef(uuidv7());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/v1/purchases/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body = (await r.json()) as PurchaseDetail;
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setError(t("saveFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  async function act(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    const failure = await send(path, "POST", body, t);
    setBusy(false);
    if (failure) setError(failure);
    else await onChanged();
  }

  return (
    <Dialog title={detail?.supplierName ?? t("loading")} wide>
      {detail && (
        <>
          <p className="font-bold text-muted">
            {dateText(detail.purchasedAt, lang)}{detail.invoiceNo ? ` · ${detail.invoiceNo}` : ""}
          </p>
          <ul>
            {detail.lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 border-b-2 border-line/20 py-2">
                <span className="relative h-12 w-12 shrink-0 bg-tile">
                  <ProductImage product={l} lang={lang} />
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">{name(l, lang)}</span>
                <span className="font-bold">{l.receivedQty !== l.qty && detail.status !== "ordered" ? `${formatQty(l.receivedQty, l.unit, lang)} / ` : ""}{formatQty(l.qty, l.unit, lang)} × {formatTaka(l.unitCostPoisha, lang)}</span>
                <span className="w-24 text-right font-black">{formatTaka(lineAmount(l.qty, l.unitCostPoisha), lang)}</span>
              </li>
            ))}
          </ul>
          {detail.discountPoisha > 0 && (
            <div className="flex justify-between font-bold"><span>{t("discount")}</span><span>−{formatTaka(detail.discountPoisha, lang)}</span></div>
          )}
          <div className="flex justify-between text-2xl font-black"><span>{t("total")}</span><span>{formatTaka(detail.totalPoisha, lang)}</span></div>
          {detail.status === "received" && (
            <div className="flex justify-between font-bold"><span>{t("paidAtPurchase")}</span><span>{formatTaka(detail.paidPoisha, lang)}</span></div>
          )}
          {(detail.status === "received" || detail.status === "partial") && (
            <section className="space-y-2 border-t-[3px] border-line pt-3">
              <h3 className="text-lg font-black">{t("returnToSupplier")}</h3>
              {detail.lines.map((l) => {
                const left = l.receivedQty - l.returnedQty;
                return (
                  <label key={l.lineNo} className="flex items-center justify-between gap-3 font-bold">
                    <span className="min-w-0 truncate">{name(l, lang)} · {formatQty(left, l.unit, lang)}</span>
                    <input aria-label={`${t("returnToSupplier")}: ${name(l, lang)}`} inputMode="decimal" disabled={left <= 0} value={back[l.lineNo] ?? ""} onChange={(e) => setBack((b) => ({ ...b, [l.lineNo]: digits(e.target.value) }))} placeholder="0" className="h-12 w-24 border-[3px] border-line bg-bg px-2 text-right font-black" />
                  </label>
                );
              })}
              <button
                disabled={busy || !Object.values(back).some((v) => Number(v) > 0)}
                className={`${secondary} w-full disabled:opacity-40`}
                onClick={() =>
                  void act(`/v1/purchases/${id}/returns`, {
                    id: returnId.current,
                    lines: Object.entries(back).filter(([, v]) => Number(v) > 0).map(([lineNo, v]) => ({ lineNo: Number(lineNo), qty: Math.round(Number(v) * QTY_SCALE) })),
                  })
                }
              >
                {t("confirmReturn")}
              </button>
              <button disabled={busy} className="min-h-11 w-full font-bold text-hot underline" onClick={() => (confirmVoid ? void act(`/v1/purchases/${id}/void`, {}) : setConfirmVoid(true))}>
                {confirmVoid ? t("archiveConfirm") : t("voidPurchase")}
              </button>
            </section>
          )}
          {(detail.status === "ordered" || detail.status === "partial") && (
            <>
              <h3 className="text-lg font-black">{t("arrivedNow")}</h3>
              {detail.lines.filter((l) => l.qty > l.receivedQty).map((l) => (
                <div key={l.lineNo} className="space-y-1 border-b-2 border-line/20 pb-2">
                  <label className="flex items-center justify-between gap-3 font-bold">
                    <span className="min-w-0 truncate">{name(l, lang)} · {formatQty(l.qty - l.receivedQty, l.unit, lang)}</span>
                    <input aria-label={`${t("arrivedNow")}: ${name(l, lang)}`} inputMode="decimal" value={arriving[l.lineNo] ?? String((l.qty - l.receivedQty) / QTY_SCALE)} onChange={(e) => setArriving((a) => ({ ...a, [l.lineNo]: digits(e.target.value) }))} className="h-12 w-24 border-[3px] border-line bg-bg px-2 text-right font-black" />
                  </label>
                  <ArrivalFields tracking={l.tracking} value={arrivals[l.lineNo] ?? noArrival} t={t} onChange={(a) => setArrivals((all) => ({ ...all, [l.lineNo]: a }))} />
                </div>
              ))}
              <PaymentFields t={t} lang={lang} paid={paid} setPaid={setPaid} method={method} setMethod={setMethod} reference={reference} setReference={setReference} full={detail.totalPoisha} />
              <button disabled={busy} className={`${primary} w-full`} onClick={() =>
                  void act(`/v1/purchases/${id}/receive`, {
                    id: receiptId.current,
                    lines: detail.lines
                      .filter((l) => l.qty > l.receivedQty)
                      .map((l) => {
                        const qty = Math.round(Number(arriving[l.lineNo] ?? (l.qty - l.receivedQty) / QTY_SCALE) * QTY_SCALE);
                        return { lineNo: l.lineNo, qty, ...arrivalPayload(l.tracking, arrivals[l.lineNo] ?? noArrival, qty).fields };
                      })
                      .filter((l) => l.qty > 0),
                    paidPoisha: money(paid),
                    paymentMethod: method,
                    paymentRef: reference.trim() || null,
                  })
                }>
                {t("receiveGoods")}
              </button>
              {detail.status === "ordered" ? (
                <button
                  disabled={busy}
                  className="min-h-11 w-full font-bold text-hot underline"
                  onClick={() => (confirmCancel ? void act(`/v1/purchases/${id}/cancel`, {}) : setConfirmCancel(true))}
                >
                  {confirmCancel ? t("archiveConfirm") : t("cancelOrder")}
                </button>
              ) : (
                <button disabled={busy} className="min-h-11 w-full font-bold text-hot underline" onClick={() => (confirmClose ? void act(`/v1/purchases/${id}/close`, {}) : setConfirmClose(true))}>
                  {confirmClose ? t("archiveConfirm") : t("closeShort")}
                </button>
              )}
            </>
          )}
        </>
      )}
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
      <button className={`${secondary} w-full`} onClick={onClose}>{t("close")}</button>
    </Dialog>
  );
}

function SupplierForm({ supplier, t, onClose, onSaved }: { supplier: SupplierSummary | null; t: T; onClose: () => void; onSaved: () => Promise<void> }) {
  const [supplierName, setSupplierName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function run(path: string, method: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    const failure = await send(path, method, body, t);
    setBusy(false);
    if (failure) setError(failure);
    else await onSaved();
  }

  const body = { name: supplierName, phone: phone || null, address: address.trim() || null };
  return (
    <Dialog title={supplier ? t("editSupplier") : t("addSupplier")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (supplier ? run(`/v1/suppliers/${supplier.id}`, "PATCH", body) : run("/v1/suppliers", "POST", body));
        }}
      >
        <label className="block font-bold">{t("supplierName")}<input autoFocus required maxLength={120} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={field} /></label>
        <label className="block font-bold">{t("phone")}<input inputMode="tel" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="01XXXXXXXXX" className={field} /></label>
        <label className="block font-bold">{t("address")}<input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={field} /></label>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={`${secondary} flex-1`} onClick={onClose}>{t("cancel")}</button>
          <button type="submit" disabled={busy} className={`${primary} flex-[2]`}>{busy ? t("saving") : t("save")}</button>
        </div>
        {supplier && (
          <button
            type="button"
            className="min-h-11 w-full font-bold text-hot underline"
            onClick={() => (confirmRemove ? void run(`/v1/suppliers/${supplier.id}`, "DELETE") : setConfirmRemove(true))}
          >
            {confirmRemove ? t("archiveConfirm") : t("removeSupplier")}
          </button>
        )}
      </form>
    </Dialog>
  );
}

function SupplierView({
  id, lang, t, onClose, onEdit, onChanged,
}: { id: string; lang: Lang; t: T; onClose: () => void; onEdit: (s: SupplierSummary) => void; onChanged: () => Promise<unknown> }) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<SupplierPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentId = useRef(uuidv7());
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const r = await apiFetch(`/v1/suppliers/${id}`);
    if (!r.ok) throw new Error();
    setDetail((await r.json()) as SupplierDetail);
    setPage(1);
  }, [id]);

  async function more() {
    const r = await apiFetch(`/v1/suppliers/${id}?page=${page + 1}`);
    if (!r.ok) return;
    const next = (await r.json()) as SupplierDetail;
    setDetail((d) => (d ? { ...next, payments: [...d.payments, ...next.payments] } : next));
    setPage(page + 1);
  }

  useEffect(() => {
    load().catch(() => setError(t("saveFailed")));
  }, [load, t]);

  async function pay() {
    if (busy || money(amount) <= 0) return;
    setBusy(true);
    setError("");
    const failure = await send(`/v1/suppliers/${id}/payments`, "POST", { id: paymentId.current, amountPoisha: money(amount), method, ref: reference.trim() || null }, t);
    if (failure) {
      setError(failure);
    } else {
      paymentId.current = uuidv7();
      setAmount("");
      setReference("");
      await Promise.all([load(), onChanged()]).catch(() => setError(t("saveFailed")));
    }
    setBusy(false);
  }

  const supplier = detail?.supplier;
  return (
    <Dialog title={supplier?.name ?? t("loading")}>
      {supplier && detail && (
        <>
          <p className="font-bold text-muted">{[supplier.phone, supplier.address].filter(Boolean).join(" · ") || "—"}</p>
          <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
            <span className="text-lg font-black">{supplier.duePoisha < 0 ? t("advance") : t("due")}</span>
            <span data-testid="supplier-due" className="text-4xl font-black">{formatTaka(Math.abs(supplier.duePoisha), lang)}</span>
          </div>
          {(
            <>
              <PaymentFields t={t} lang={lang} paid={amount} setPaid={setAmount} method={method} setMethod={setMethod} reference={reference} setReference={setReference} full={Math.max(supplier.duePoisha, 0)} />
              {money(amount) > Math.max(supplier.duePoisha, 0) && <p data-testid="advance-note" className="font-bold text-muted">{t("advanceNote")}</p>}
              <button disabled={busy || money(amount) <= 0} className={`${primary} w-full`} onClick={() => void pay()}>{t("recordPayment")}</button>
            </>
          )}
          {detail.payments.length > 0 && (
            <>
              <h3 className="text-lg font-black">{t("paymentHistory")}</h3>
              <ul>
                {detail.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 border-b-2 border-line/20 py-2 font-bold">
                    <span>{dateText(p.paidAt, lang)} · {t(p.method as StringKey)}{p.ref ? ` · ${p.ref}` : ""}</span>
                    <span className="font-black">{formatTaka(p.amountPoisha, lang)}</span>
                  </li>
                ))}
              </ul>
              {detail.hasMore && <button className={`${secondary} w-full`} onClick={() => void more()}>{t("loadMore")}</button>}
            </>
          )}
        </>
      )}
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
      <div className="flex gap-2">
        <button className={`${secondary} flex-1`} onClick={onClose}>{t("close")}</button>
        {supplier && <button className={`${secondary} flex-1`} onClick={() => onEdit(supplier)}>{t("editSupplier")}</button>}
      </div>
    </Dialog>
  );
}
