import { formatTaka, type Lang } from "@lalcha/domain";
import { useMemo, useState } from "react";
import type { StringKey } from "./i18n";
import { name, ProductImage } from "./ProductImage";
import type { Sellable } from "./sellables";
import { apiFetch } from "./session";

const taka = (poisha: number | null | undefined) => (poisha == null ? "" : String(poisha / 100));
const toPoisha = (text: string) => Math.round(Number(text) * 100);

/**
 * Today's rates: every product whose price moves day to day (onion, eggs, rod, gold) on one page, so
 * the morning's prices go in with a few taps instead of opening products one by one.
 */
export function RatesScreen({ products, lang, t, online, onChanged }: { products: Sellable[]; lang: Lang; t: (k: StringKey) => string; online: boolean; onChanged: () => Promise<void> }) {
  const list = useMemo(() => products.filter((p) => p.dailyRate), [products]);
  const [edits, setEdits] = useState<Record<string, { price?: string; wholesale?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const anyWholesale = list.some((p) => p.wholesalePricePoisha != null);

  const changed = list.flatMap((p) => {
    const e = edits[p.id];
    if (!e) return [];
    const pricePoisha = e.price !== undefined && e.price.trim() !== "" ? toPoisha(e.price) : p.pricePoisha;
    const wholesalePricePoisha = e.wholesale !== undefined ? (e.wholesale.trim() === "" ? null : toPoisha(e.wholesale)) : (p.wholesalePricePoisha ?? null);
    if (pricePoisha === p.pricePoisha && wholesalePricePoisha === (p.wholesalePricePoisha ?? null)) return [];
    return [{ id: p.id, pricePoisha, wholesalePricePoisha }];
  });
  const invalid = changed.some((c) => !Number.isFinite(c.pricePoisha) || c.pricePoisha < 0 || (c.wholesalePricePoisha !== null && (!Number.isFinite(c.wholesalePricePoisha) || c.wholesalePricePoisha < 0)));

  async function save() {
    if (busy || !changed.length || invalid) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await apiFetch("/v1/prices", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prices: changed }) });
      if (!res.ok) throw new Error();
      await onChanged();
      setEdits({});
      setMessage(t("ratesSaved"));
    } catch {
      setMessage(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const input = "h-12 w-full border-[3px] border-line bg-bg px-2 text-right text-lg font-black";
  const set = (id: string, patch: { price?: string; wholesale?: string }) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  return (
    <main className="no-print flex min-h-0 flex-1 flex-col">
      <div className="p-3 pb-2">
        <h1 className="text-2xl font-black">{t("rates")}</h1>
        <p className="font-bold text-muted">{t("ratesHelp")}</p>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3">
        {list.length === 0 && <li className="p-10 text-center text-lg font-bold text-muted">{t("ratesEmpty")}</li>}
        {list.map((p) => (
          <li key={p.id} className="mb-2 flex items-center gap-3 border-[3px] border-line bg-panel p-2">
            <div className="relative h-14 w-14 shrink-0 bg-tile"><ProductImage product={p} lang={lang} /></div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">{name(p, lang)}</span>
              <span className="block text-sm font-bold text-muted">{t("ratesNow")}: {formatTaka(p.pricePoisha, lang)}</span>
            </span>
            <label className="w-28 text-sm font-bold">
              {t("retail")}
              <input aria-label={`${t("retail")}: ${name(p, lang)}`} inputMode="decimal" value={edits[p.id]?.price ?? taka(p.pricePoisha)} onChange={(e) => set(p.id, { price: e.target.value.replace(/[^0-9.]/g, "") })} className={input} />
            </label>
            {anyWholesale && (
              <label className="w-28 text-sm font-bold">
                {t("wholesale")}
                <input aria-label={`${t("wholesale")}: ${name(p, lang)}`} inputMode="decimal" value={edits[p.id]?.wholesale ?? taka(p.wholesalePricePoisha)} onChange={(e) => set(p.id, { wholesale: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="—" className={input} />
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t-[3px] border-line bg-panel p-3">
        {message && <p role="status" className="mb-2 font-bold">{message}</p>}
        <button data-testid="save-rates" disabled={busy || !online || !changed.length || invalid} onClick={() => void save()} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">
          {busy ? t("saving") : `${t("saveRates")}${changed.length ? ` (${changed.length})` : ""}`}
        </button>
      </div>
    </main>
  );
}
