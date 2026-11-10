import { BUSINESS_PROFILES, BUSINESS_TYPES, FEATURE_LABELS, FEATURES, type BusinessType, type Feature, type Lang, type StoreSettings, type TableRecord } from "@lalcha/domain";
import { useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { loadTables } from "./local";
import { PrinterSetup } from "./PrinterSetup";
import { apiFetch } from "./session";

const field = "mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const box = "space-y-3 border-[3px] border-line bg-panel p-4";

export function SettingsScreen({ settings, lang, t, online, onChanged }: { settings: StoreSettings; lang: Lang; t: (k: StringKey) => string; online: boolean; onChanged: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(settings.vatEnabled);
  const [inclusive, setInclusive] = useState(settings.vatInclusive);
  const [scale, setScale] = useState(settings.scaleEnabled);
  const [prefix, setPrefix] = useState(settings.scalePrefix);
  const [mode, setMode] = useState(settings.scaleMode);
  const [rate, setRate] = useState(settings.vatRateBp ? String(settings.vatRateBp / 100) : "");
  const [bin, setBin] = useState(settings.bin ?? "");
  const [address, setAddress] = useState(settings.address ?? "");
  const [phone, setPhone] = useState(settings.phone ?? "");
  const [type, setType] = useState<BusinessType | null>(settings.businessType);
  const [features, setFeatures] = useState<Feature[]>(settings.features);
  const [earn, setEarn] = useState(String(settings.loyaltyEarnPoisha / 100));
  const [pointValue, setPointValue] = useState(String(settings.loyaltyPointPoisha / 100));
  const [alertDays, setAlertDays] = useState(String(settings.expiryAlertDays));
  const [printing, setPrinting] = useState({ receiptPrinter: settings.receiptPrinter, paperWidth: settings.paperWidth, cashDrawer: settings.cashDrawer, kitchenTickets: settings.kitchenTickets });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const vatRateBp = Math.round(Number(rate || 0) * 100);
    const loyaltyEarnPoisha = Math.round(Number(earn) * 100);
    const loyaltyPointPoisha = Math.round(Number(pointValue) * 100);
    const expiryAlertDays = Math.round(Number(alertDays));
    if (!Number.isFinite(vatRateBp) || vatRateBp < 0 || vatRateBp > 10_000 || (enabled && vatRateBp === 0) || !(loyaltyEarnPoisha >= 100) || !(loyaltyPointPoisha >= 1) || !(expiryAlertDays >= 1 && expiryAlertDays <= 365)) {
      setMessage(t("badNumber"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await apiFetch("/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings, vatEnabled: enabled, vatRateBp, vatInclusive: inclusive, scaleEnabled: scale, scalePrefix: prefix, scaleMode: mode,
          bin: bin.trim() || null, address: address.trim() || null, phone: phone.trim() || null,
          businessType: type, features, loyaltyEarnPoisha, loyaltyPointPoisha, expiryAlertDays, ...printing, onboarded: true,
        }),
      });
      if (!res.ok) throw new Error();
      await onChanged();
      setMessage(t("saved"));
    } catch {
      setMessage(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const has = (f: Feature) => features.includes(f);

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <form className="mx-auto max-w-lg space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}

        <section className={box}>
          <h1 className="text-2xl font-black">{t("shopType")}</h1>
          <select value={type ?? ""} onChange={(e) => setType((e.target.value || null) as BusinessType | null)} className={field}>
            {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{BUSINESS_PROFILES[b].icon} {BUSINESS_PROFILES[b].name[lang]}</option>)}
          </select>
          <h2 className="pt-1 text-xl font-black">{t("features")}</h2>
          {FEATURES.map((f) => (
            <label key={f} className="flex min-h-11 items-start gap-3 font-bold">
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={has(f)} onChange={(e) => setFeatures((list) => (e.target.checked ? [...list, f] : list.filter((x) => x !== f)))} />
              <span>{FEATURE_LABELS[f].name[lang]}<span className="block text-sm text-muted">{FEATURE_LABELS[f].help[lang]}</span></span>
            </label>
          ))}
        </section>

        {has("loyalty") && (
          <section className={box}>
            <h2 className="text-xl font-black">{t("loyaltySettings")}</h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="block font-bold">{t("earnRate")}<input inputMode="decimal" value={earn} onChange={(e) => setEarn(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
              <label className="block font-bold">{t("pointValue")}<input inputMode="decimal" value={pointValue} onChange={(e) => setPointValue(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
            </div>
          </section>
        )}

        {has("batches") && (
          <section className={box}>
            <label className="block font-bold">{t("expiryAlert")}<input inputMode="numeric" value={alertDays} onChange={(e) => setAlertDays(e.target.value.replace(/\D/g, ""))} className={field} /></label>
          </section>
        )}

        <section className={box}>
          <h2 className="text-xl font-black">{t("printerSettings")}</h2>
          <PrinterSetup value={printing} restaurant={has("restaurant")} t={t} onChange={setPrinting} />
        </section>

        <section className={box}>
          <h2 className="text-xl font-black">{t("vatSettings")}</h2>
          <label className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-6 w-6" />
            {t("enableVat")}
          </label>
          <label className="block font-bold">{t("vatRate")}<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
          <label className="block font-bold">
            {t("vatPricing")}
            <select value={inclusive ? "in" : "out"} onChange={(e) => setInclusive(e.target.value === "in")} className={field}>
              <option value="in">{t("vatInPrice")}</option>
              <option value="out">{t("vatOnTop")}</option>
            </select>
          </label>
          <label className="block font-bold">{t("bin")}<input maxLength={30} value={bin} onChange={(e) => setBin(e.target.value)} className={field} /></label>
          <label className="block font-bold">{t("storeAddressLine")}<input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={field} /></label>
          <label className="block font-bold">{t("storePhone")}<input maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={field} /></label>
        </section>

        <section className={box}>
          <h2 className="text-xl font-black">{t("scaleSettings")}</h2>
          <label className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} className="h-6 w-6" />
            {t("enableScale")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block font-bold">{t("scalePrefix")}<input inputMode="numeric" maxLength={2} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} className={field} /></label>
            <label className="block font-bold">
              {t("scaleValue")}
              <select value={mode} onChange={(e) => setMode(e.target.value as "weight" | "price")} className={field}>
                <option value="weight">{t("scaleWeight")}</option>
                <option value="price">{t("scalePrice")}</option>
              </select>
            </label>
          </div>
          <p className="font-bold text-muted">{t("scaleHelp")}</p>
        </section>

        {message && <p role="status" className="font-bold">{message}</p>}
        <button type="submit" disabled={busy || !online} className="sticky bottom-2 min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("save")}</button>
      </form>
      {has("restaurant") && <TablesSetup t={t} online={online} onChanged={onChanged} />}
    </main>
  );
}

/** Tables save one by one, straight away, so a long list isn't lost to one failed save. */
function TablesSetup({ t, online, onChanged }: { t: (k: StringKey) => string; online: boolean; onChanged: () => Promise<void> }) {
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [error, setError] = useState("");
  useEffect(() => void loadTables().then(setTables), []);

  async function add() {
    if (!name.trim()) return;
    const table: TableRecord = { id: uuidv7(), name: name.trim(), area: area.trim() || null, seats: null };
    const res = await apiFetch("/v1/tables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(table) }).catch(() => null);
    if (!res?.ok) return setError(t("saveFailed"));
    setError("");
    setTables((list) => [...list, table]);
    setName("");
    await onChanged();
  }

  async function remove(id: string) {
    const res = await apiFetch(`/v1/tables/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError(t("saveFailed"));
    setTables((list) => list.filter((x) => x.id !== id));
    await onChanged();
  }

  return (
    <section className={`${box} mx-auto mt-3 max-w-lg`}>
      <h2 className="text-xl font-black">{t("tablesSetup")}</h2>
      <ul className="flex flex-wrap gap-2">
        {tables.map((x) => (
          <li key={x.id} className="flex items-center gap-1 border-2 border-line px-2 py-1 font-bold">
            {x.name}{x.area ? ` · ${x.area}` : ""}
            <button aria-label={`${t("remove")}: ${x.name}`} className="h-8 w-8 font-black" onClick={() => void remove(x.id)}>✕</button>
          </li>
        ))}
      </ul>
      <form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input aria-label={t("tableName")} placeholder={t("tableName")} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-12 min-w-0 border-[3px] border-line bg-bg px-2 font-bold" />
        <input aria-label={t("tableArea")} placeholder={t("tableArea")} maxLength={40} value={area} onChange={(e) => setArea(e.target.value)} className="h-12 min-w-0 border-[3px] border-line bg-bg px-2 font-bold" />
        <button disabled={!online} className="min-h-12 bg-[#12130f] px-3 font-black text-accent ring-2 ring-line disabled:opacity-40">{t("addTable")}</button>
      </form>
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
    </section>
  );
}
