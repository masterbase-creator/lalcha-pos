import type { Lang } from "@lalcha/domain";
import { useEffect, useState } from "react";
import { strings, type StringKey } from "./i18n";
import { remember, saved } from "./prefs";

const field = "mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const ERRORS: StringKey[] = ["invalid_phone", "invalid_pin", "weak_pin", "invalid_code", "subdomain_taken", "invalid_subdomain", "reserved_subdomain", "name_required"];

export function Signup() {
  const [lang, setLang] = useState<Lang>(() => saved<Lang>("lang", "bn"));
  const t = (k: StringKey) => strings[lang][k];
  const [storeName, setStoreName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (!subdomain) {
      setAvailability(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch(`/v1/public/subdomain?name=${encodeURIComponent(subdomain)}`)
        .then((r) => r.json())
        .then(setAvailability)
        .catch(() => setAvailability(null));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [subdomain]);

  const messageFor = (reason?: string) => (reason && ERRORS.includes(reason as StringKey) ? t(reason as StringKey) : t("saveFailed"));

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; devCode?: string; subdomain?: string; baseDomain?: string };
    return { ok: res.ok, data };
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!sent) {
        if (availability && !availability.available) {
          setError(messageFor(availability.reason));
          return;
        }
        const { ok, data } = await post("/v1/public/signup/request-code", { phone });
        if (!ok) {
          setError(messageFor(data.error));
          return;
        }
        setDevCode(data.devCode ?? null);
        setSent(true);
      } else {
        const { ok, data } = await post("/v1/public/signup", { storeName, subdomain, ownerName, phone, pin, code });
        if (!ok) {
          setError(messageFor(data.error));
          return;
        }
        const port = location.port ? `:${location.port}` : "";
        setCreated(`${location.protocol}//${data.subdomain}.${data.baseDomain}${port}/`);
      }
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between bg-[#12130f] px-4 py-2.5">
        <span className="bg-accent px-2 py-0.5 text-lg font-black text-on-accent">Lalcha</span>
        <button
          className="min-h-9 border border-white/40 px-3 text-sm font-bold text-[#f6f3e7]"
          onClick={() => {
            const next = lang === "bn" ? "en" : "bn";
            remember("lang", next);
            document.documentElement.lang = next;
            setLang(next);
          }}
        >
          {lang === "bn" ? "EN" : "বাং"}
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {created ? (
          <div className="mx-auto mt-6 max-w-md space-y-4 border-[3px] border-line bg-panel p-5">
            <h1 className="text-3xl font-black">{t("storeReady")}</h1>
            <p className="font-bold">{t("storeReadyHelp")}</p>
            <p data-testid="store-url" className="bg-accent p-3 font-black break-all text-on-accent">{created}</p>
            <a href={created} className="flex min-h-16 items-center justify-center bg-[#12130f] text-xl font-black text-accent ring-2 ring-line">{t("openStore")}</a>
          </div>
        ) : (
          <form
            className="mx-auto max-w-md space-y-3 border-[3px] border-line bg-panel p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h1 className="text-3xl font-black">{t("signupTitle")}</h1>
            <p className="font-bold text-muted">{t("signupHelp")}</p>
            <label className="block font-bold">{t("storeName")}<input autoFocus required disabled={sent} maxLength={100} value={storeName} onChange={(e) => setStoreName(e.target.value)} className={field} /></label>
            <label className="block font-bold">
              {t("storeAddress")}
              <input
                required
                disabled={sent}
                maxLength={30}
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="mystore"
                className={field}
              />
              {availability && (
                <span data-testid="availability" className={`mt-1 block ${availability.available ? "" : "text-hot"}`}>
                  {availability.available ? `✓ ${t("subdomainFree")}` : `✕ ${messageFor(availability.reason)}`}
                </span>
              )}
            </label>
            <label className="block font-bold">{t("ownerName")}<input required disabled={sent} maxLength={100} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={field} /></label>
            <label className="block font-bold">{t("phone")}<input required disabled={sent} inputMode="tel" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="01XXXXXXXXX" className={field} /></label>
            <label className="block font-bold">{t("pin")}<input required type="password" autoComplete="new-password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={field} /></label>
            {sent && (
              <>
                {devCode && <p data-testid="dev-code" className="bg-accent p-2 font-black text-on-accent">{t("devCode")}: {devCode}</p>}
                <label className="block font-bold">{t("code")}<input autoFocus required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={field} /></label>
              </>
            )}
            {error && <p role="alert" className="font-bold text-hot">{error}</p>}
            <button type="submit" disabled={busy} className="min-h-16 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">
              {sent ? t("createStore") : t("sendCode")}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
