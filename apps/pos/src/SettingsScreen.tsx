import type { StoreSettings } from "@lalcha/domain";
import { useState } from "react";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

const field = "mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";

export function SettingsScreen({ settings, t, online, onChanged }: { settings: StoreSettings; t: (k: StringKey) => string; online: boolean; onChanged: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(settings.vatEnabled);
  const [rate, setRate] = useState(settings.vatRateBp ? String(settings.vatRateBp / 100) : "");
  const [bin, setBin] = useState(settings.bin ?? "");
  const [address, setAddress] = useState(settings.address ?? "");
  const [phone, setPhone] = useState(settings.phone ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const vatRateBp = Math.round(Number(rate || 0) * 100);
    if (!Number.isFinite(vatRateBp) || vatRateBp < 0 || vatRateBp > 10_000 || (enabled && vatRateBp === 0)) {
      setMessage(t("badNumber"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await apiFetch("/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vatEnabled: enabled, vatRateBp, bin: bin.trim() || null, address: address.trim() || null, phone: phone.trim() || null }),
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

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <form className="mx-auto max-w-lg space-y-3 border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h1 className="text-2xl font-black">{t("vatSettings")}</h1>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        <label className="flex min-h-11 items-center gap-3 font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-6 w-6" />
          {t("enableVat")}
        </label>
        <label className="block font-bold">{t("vatRate")}<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
        <p className="font-bold text-muted">{t("vatHelp")}</p>
        <label className="block font-bold">{t("bin")}<input maxLength={30} value={bin} onChange={(e) => setBin(e.target.value)} className={field} /></label>
        <label className="block font-bold">{t("storeAddressLine")}<input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={field} /></label>
        <label className="block font-bold">{t("storePhone")}<input maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={field} /></label>
        {message && <p role="status" className="font-bold">{message}</p>}
        <button type="submit" disabled={busy || !online} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("save")}</button>
      </form>
    </main>
  );
}
