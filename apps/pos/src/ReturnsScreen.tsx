import { formatQty, formatTaka, isLoose, QTY_SCALE, returnValue, type CatalogProduct, type CustomerSummary, type Lang, type ReturnResult } from "@lalcha/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { enqueueOp, loadLocalSales, type LocalSale } from "./local";
import { ProductImage } from "./ProductImage";
import { getAuth } from "./session";

type T = (k: StringKey) => string;
const REFUND_METHODS = ["cash", "bkash", "nagad", "card"] as const;
type RefundMethod = (typeof REFUND_METHODS)[number];
const whenText = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB");

/** Works from this device's copy of recent sales, so returns keep going during an outage. */
export function ReturnsScreen({
  products, customers, storeName, lang, t, version, onChanged,
}: { products: CatalogProduct[]; customers: CustomerSummary[]; storeName: string; lang: Lang; t: T; version: number; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [open, setOpen] = useState<LocalSale | null>(null);

  const load = useCallback(async () => setSales(await loadLocalSales()), []);
  useEffect(() => {
    void load();
  }, [load, version]);

  const q = query.trim().toLowerCase();
  const visible = sales.filter((s) => !q || s.receiptNo.toLowerCase().includes(q)).slice(0, 100);

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchReceipt")} aria-label={t("searchReceipt")} className="h-13 w-full border-[3px] border-line bg-panel px-3 text-lg font-bold" />
        {visible.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noSales")}</p>}
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id}>
              <button onClick={() => setOpen(s)} className="flex min-h-16 w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-black">#{s.receiptNo}</span>
                  <span className="block truncate text-sm font-bold text-muted">{whenText(s.soldAt, lang)} · {t(s.paymentMethod as StringKey)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xl font-black">{formatTaka(s.totalPoisha, lang)}</span>
                  {s.returnedPoisha > 0 && <span className="block text-sm font-bold text-hot">{t("returned")} {formatTaka(s.returnedPoisha, lang)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {open && (
        <SaleReturn sale={open} products={products} customers={customers} storeName={storeName} lang={lang} t={t} onClose={() => setOpen(null)} onDone={async () => { await load(); await onChanged(); }} />
      )}
    </main>
  );
}

function SaleReturn({
  sale, products, customers, storeName, lang, t, onClose, onDone,
}: { sale: LocalSale; products: CatalogProduct[]; customers: CustomerSummary[]; storeName: string; lang: Lang; t: T; onClose: () => void; onDone: () => Promise<void> }) {
  const [picked, setPicked] = useState<Record<number, { qty: number; restock: boolean }>>({});
  const [method, setMethod] = useState<RefundMethod>("cash");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [resultAt, setResultAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnId = useRef(uuidv7());

  const money = (p: number) => formatTaka(p, lang);
  const estimate = Math.min(
    sale.lines.reduce((sum, l) => sum + returnValue(picked[l.lineNo]?.qty ?? 0, l.qty, l.finalPoisha), 0),
    sale.totalPoisha - sale.returnedPoisha,
  );
  const lines = Object.entries(picked).filter(([, v]) => v.qty > 0).map(([lineNo, v]) => ({ lineNo: Number(lineNo), qty: v.qty, restock: v.restock }));

  function change(lineNo: number, max: number, delta: number) {
    setPicked((p) => {
      const current = p[lineNo] ?? { qty: 0, restock: true };
      return { ...p, [lineNo]: { ...current, qty: Math.min(max, Math.max(0, current.qty + delta)) } };
    });
  }

  async function submit() {
    if (busy || lines.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const units = sale.lines.reduce((n, l) => n + l.qty, 0);
      const back = sale.lines.reduce((n, l) => n + l.returnedQty, 0) + lines.reduce((n, l) => n + l.qty, 0);
      const value = back === units ? sale.totalPoisha - sale.returnedPoisha : estimate;
      let credit = 0;
      if (sale.paymentMethod === "baki" && sale.customerId) {
        const owed = customers.find((c) => c.id === sale.customerId)?.duePoisha ?? 0;
        credit = Math.max(0, Math.min(value, sale.totalPoisha - sale.tenderedPoisha - sale.creditedPoisha, owed));
      }
      await enqueueOp("sale_return", returnId.current, getAuth().user!.id, {
        saleId: sale.id, id: returnId.current, lines, refundMethod: method, refundRef: reference.trim() || null, creditPoisha: credit, valuePoisha: value,
      });
      setResult({ valuePoisha: value, creditPoisha: credit, refundPoisha: value - credit });
      setResultAt(new Date().toISOString());
      await onDone();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const productFor = (id: string) => products.find((p) => p.id === id);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("returns")}>
      <div className="max-h-full w-full max-w-2xl space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4">
        <h2 className="text-2xl font-black">#{sale.receiptNo}</h2>
        {result ? (
          <>
            <div id="receipt" className="space-y-1 border-[3px] border-line p-3 text-sm">
              <h3 className="text-center text-xl font-black">{storeName}</h3>
              <p className="text-center font-black">{t("returnReceipt")}</p>
              <p className="text-center">{whenText(resultAt, lang)}</p>
              <p className="text-center font-bold">{t("originalReceipt")}: #{sale.receiptNo}</p>
              <div className="border-y-2 border-dashed border-line py-1">
                {lines.map((l) => {
                  const line = sale.lines.find((x) => x.lineNo === l.lineNo)!;
                  return <div key={l.lineNo} className="flex justify-between gap-2"><span>{line.name}</span><span className="font-bold">{formatQty(l.qty, line.unit, lang)}</span></div>;
                })}
              </div>
              <div className="flex justify-between text-xl font-black"><span>{t("returnValue")}</span><span data-testid="return-value">{money(result.valuePoisha)}</span></div>
              {result.creditPoisha > 0 && <div className="flex justify-between font-bold"><span>{t("takenOffBaki")}</span><span>{money(result.creditPoisha)}</span></div>}
              <div className="flex justify-between font-black"><span>{t("giveBack")} ({t(method)})</span><span data-testid="refund-value">{money(result.refundPoisha)}</span></div>
            </div>
            <button className="min-h-14 w-full border-[3px] border-line text-lg font-black no-print" onClick={() => window.print()}>{t("print")}</button>
          </>
        ) : (
          <>
            <p className="font-bold text-muted">{whenText(sale.soldAt, lang)} · {t(sale.paymentMethod as StringKey)}</p>
            <ul>
              {sale.lines.map((l) => {
                const left = l.qty - l.returnedQty;
                const chosen = picked[l.lineNo] ?? { qty: 0, restock: true };
                const step = isLoose(l.unit) ? QTY_SCALE / 4 : QTY_SCALE;
                const product = productFor(l.productId);
                return (
                  <li key={l.lineNo} className="border-b-2 border-line/20 py-2">
                    <div className="flex items-center gap-2">
                      <span className="relative h-12 w-12 shrink-0 bg-tile">{product && <ProductImage product={product} lang={lang} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{l.name}</span>
                        <span className="block text-sm font-bold text-muted">{formatQty(left, l.unit, lang)} / {formatQty(l.qty, l.unit, lang)} · {money(l.unitPricePoisha)}</span>
                      </span>
                      <button disabled={chosen.qty === 0} aria-label={`${t("decrease")}: ${l.name}`} className="h-11 w-11 border-2 border-line text-xl font-black disabled:opacity-30" onClick={() => change(l.lineNo, left, -step)}>−</button>
                      <span className="w-16 text-center font-black">{formatQty(chosen.qty, l.unit, lang)}</span>
                      <button disabled={chosen.qty >= left} aria-label={`${t("increase")}: ${l.name}`} className="h-11 w-11 border-2 border-line text-xl font-black disabled:opacity-30" onClick={() => change(l.lineNo, left, step)}>+</button>
                    </div>
                    {chosen.qty > 0 && (
                      <label className="mt-1 flex min-h-11 items-center gap-3 font-bold">
                        <input type="checkbox" checked={chosen.restock} onChange={(e) => setPicked((p) => ({ ...p, [l.lineNo]: { ...chosen, restock: e.target.checked } }))} className="h-6 w-6" />
                        {t("backToShelf")}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-4 gap-2">
              {REFUND_METHODS.map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line font-black ${method === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
              ))}
            </div>
            {method !== "cash" && (
              <label className="block font-bold">{t("ref")}<input maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold" /></label>
            )}
            <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
              <span className="text-lg font-black">{t("returnValue")}</span>
              <span data-testid="return-estimate" className="text-4xl font-black">{money(estimate)}</span>
            </div>
            <button disabled={busy || lines.length === 0} onClick={() => void submit()} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("confirmReturn")}</button>
          </>
        )}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <button className="min-h-14 w-full border-[3px] border-line text-lg font-black no-print" onClick={onClose}>{t("close")}</button>
      </div>
    </div>
  );
}
