import { BUSINESS_PROFILES, BUSINESS_TYPES, FEATURE_LABELS, FEATURES, type BusinessType, type Feature, type Lang, type StoreSettings } from "@lalcha/domain";
import { useState } from "react";
import type { StringKey } from "./i18n";
import { PrinterSetup } from "./PrinterSetup";
import { apiFetch } from "./session";

/**
 * Three short steps the first time an owner opens the store: what kind of shop, which features,
 * and how receipts print. Everything here can be changed later in Settings.
 */
export function Onboarding({ settings, lang, t, onDone }: { settings: StoreSettings; lang: Lang; t: (k: StringKey) => string; onDone: () => Promise<void> }) {
  const [step, setStep] = useState(settings.businessType ? 2 : 1);
  const [type, setType] = useState<BusinessType | null>(settings.businessType);
  const [features, setFeatures] = useState<Feature[]>(settings.businessType ? settings.features : []);
  const [printing, setPrinting] = useState({ receiptPrinter: settings.receiptPrinter, paperWidth: settings.paperWidth, cashDrawer: settings.cashDrawer, kitchenTickets: settings.kitchenTickets });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(next: BusinessType) {
    setType(next);
    setFeatures(BUSINESS_PROFILES[next].features);
    setStep(2);
  }

  async function finish() {
    if (!type || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, businessType: type, features, ...printing, onboarded: true }),
      });
      if (!res.ok) throw new Error();
      await onDone();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <p className="font-black text-muted">{t("onbStepOf")} {lang === "bn" ? "১২৩"[step - 1] : step}/{lang === "bn" ? "৩" : 3}</p>
          <h1 className="text-3xl font-black">{t("onbTitle")}</h1>
        </header>

        {step === 1 && (
          <section className="space-y-3">
            <h2 className="text-xl font-black">{t("onbStep1")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {BUSINESS_TYPES.map((b) => {
                const profile = BUSINESS_PROFILES[b];
                return (
                  <button key={b} aria-pressed={type === b} onClick={() => pick(b)} className={`tile-press flex min-h-20 items-center gap-3 border-[3px] p-3 text-left ${type === b ? "border-hot bg-panel" : "border-line bg-panel"}`}>
                    <span className="text-4xl" aria-hidden>{profile.icon}</span>
                    <span>
                      <span className="block text-lg font-black">{profile.name[lang]}</span>
                      <span className="block text-sm font-bold text-muted">{profile.pitch[lang]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && type && (
          <section className="space-y-3">
            <h2 className="text-xl font-black">{t("onbStep2")}</h2>
            <p className="font-bold text-muted">{t("onbStep2Help")}</p>
            <div className="space-y-2">
              {FEATURES.map((f) => (
                <label key={f} className={`flex min-h-16 cursor-pointer items-start gap-3 border-[3px] p-3 ${features.includes(f) ? "border-hot bg-panel" : "border-line bg-panel"}`}>
                  <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={features.includes(f)} onChange={(e) => setFeatures((list) => (e.target.checked ? [...list, f] : list.filter((x) => x !== f)))} />
                  <span>
                    <span className="block text-lg font-black">{FEATURE_LABELS[f].name[lang]}</span>
                    <span className="block text-sm font-bold text-muted">{FEATURE_LABELS[f].help[lang]}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-sm font-bold text-muted">{t("alwaysIncluded")}</p>
            <div className="flex gap-2">
              <button className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={() => setStep(1)}>{t("back")}</button>
              <button className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line" onClick={() => setStep(3)}>{t("next")}</button>
            </div>
          </section>
        )}

        {step === 3 && type && (
          <section className="space-y-3">
            <h2 className="text-xl font-black">{t("onbStep3")}</h2>
            <PrinterSetup value={printing} restaurant={features.includes("restaurant")} t={t} onChange={setPrinting} />
            {error && <p role="alert" className="font-bold text-hot">{error}</p>}
            <div className="flex gap-2">
              <button className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={() => setStep(2)}>{t("back")}</button>
              <button disabled={busy} className="min-h-14 flex-[2] bg-accent text-xl font-black text-on-accent ring-2 ring-line disabled:opacity-40" onClick={() => void finish()}>
                {busy ? t("saving") : t("startSelling")}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
