import type { Lang, StaffMember } from "@lalcha/domain";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { App } from "./App";
import { strings, type StringKey } from "./i18n";
import { remember, saved } from "./prefs";
import { clearDemoTill } from "./local";
import { startSync } from "./sync";
import { connectDemo, getAuth, getDemo, initAuth, lock, refreshStaff, requestCode, signIn, siteUrl, subscribeAuth, verifyCode, type DemoInfo, type SignInResult } from "./session";

/** Signup lives on the main website, not on a store's own address. */
const signupUrl = () => siteUrl("/signup/");

const IDLE_LOCK_MS = 15 * 60_000;
const fieldClass = "mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-xl font-black";

function useLang() {
  const [lang, setLangState] = useState<Lang>(() => saved<Lang>("lang", "bn"));
  const t = useCallback((k: StringKey) => strings[lang][k], [lang]);
  const toggle = () => {
    const next = lang === "bn" ? "en" : "bn";
    remember("lang", next);
    setLangState(next);
  };
  return { lang, t, toggle };
}

function Shell({ lang, toggle, children, overlay }: { lang: Lang; toggle: () => void; children: React.ReactNode; overlay?: boolean }) {
  return (
    <div className={`no-print flex flex-col bg-bg ${overlay ? "fixed inset-0 z-[60]" : "h-full"}`}>
      <header className="flex items-center justify-between border-b-[3px] border-line bg-panel px-4 py-2.5">
        <span className="flex items-center gap-2 text-lg font-black"><img src="/icon.svg" alt="" width={30} height={30} className="shrink-0" />Lalcha</span>
        <button className="min-h-9 border-2 border-line px-3 text-sm font-bold text-text" onClick={toggle}>
          {lang === "bn" ? "EN" : "বাং"}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function PairScreen() {
  const { lang, t, toggle } = useLang();
  const [byPhone, setByPhone] = useState(false);
  const [contactValue, setContactValue] = useState("");
  const contact = byPhone ? { phone: contactValue.trim() } : { email: contactValue.trim().toLowerCase() };
  const [deviceName, setDeviceName] = useState("POS 1");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!sent) {
        const res = await requestCode(contact);
        setDevCode(res.devCode ?? null);
        setSent(true);
      } else {
        const result = await verifyCode(contact, code.trim(), deviceName.trim() || "POS");
        if (result === "bad") setError(t("badCode"));
        if (result === "limit") setError(t("device_limit"));
      }
    } catch {
      setError(t("pairFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell lang={lang} toggle={toggle}>
      <form
        className="mx-auto mt-6 max-w-md space-y-4 border-[3px] border-line bg-panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-3xl font-black">{t("pairTitle")}</h1>
        <p className="font-bold text-muted">{t("pairHelp")}</p>
        {byPhone ? (
          <label className="block font-bold">
            {t("phone")}
            <input autoFocus required disabled={sent} inputMode="tel" maxLength={11} value={contactValue} onChange={(e) => setContactValue(e.target.value.replace(/\D/g, ""))} placeholder="01XXXXXXXXX" className={fieldClass} />
          </label>
        ) : (
          <label className="block font-bold">
            {t("email")}
            <input autoFocus required disabled={sent} type="email" inputMode="email" autoComplete="email" maxLength={254} value={contactValue} onChange={(e) => setContactValue(e.target.value)} placeholder="you@example.com" className={fieldClass} />
          </label>
        )}
        {!sent && (
          <button type="button" className="min-h-11 font-bold underline" onClick={() => { setByPhone(!byPhone); setContactValue(""); }}>
            {byPhone ? t("useEmail") : t("usePhone")}
          </button>
        )}
        {sent && (
          <>
            <p className="font-bold">{t("codeSent")}</p>
            {devCode && (
              <p data-testid="dev-code" className="bg-accent p-2 font-black text-on-accent">
                {t("devCode")}: {devCode}
              </p>
            )}
            <label className="block font-bold">
              {t("code")}
              <input autoFocus required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={fieldClass} />
            </label>
            <label className="block font-bold">
              {t("deviceName")}
              <input required maxLength={60} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={fieldClass} />
            </label>
          </>
        )}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <button type="submit" disabled={busy} className="min-h-16 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">
          {sent ? t("connectDevice") : t("sendCode")}
        </button>
        {!sent && <a href={signupUrl()} className="flex min-h-11 items-center justify-center font-bold underline">{t("newStoreLink")}</a>}
        {sent && (
          <button
            type="button"
            className="min-h-11 w-full font-bold underline"
            onClick={() => {
              setSent(false);
              setCode("");
              setDevCode(null);
              setError("");
            }}
          >
            {t("changePhone")}
          </button>
        )}
      </form>
    </Shell>
  );
}

/** The demo opens straight onto the till: it connects by itself, and the button is only a retry. */
function DemoStart() {
  const { lang, t, toggle } = useLang();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    if (!(await connectDemo().catch(() => false))) setError(t("pairFailed"));
    setBusy(false);
  }, [t]);
  useEffect(() => {
    void start();
  }, [start]);
  return (
    <Shell lang={lang} toggle={toggle}>
      <div className="mx-auto mt-6 max-w-md space-y-4 border-[3px] border-line bg-panel p-5">
        <h1 className="text-3xl font-black">{t("demoTitle")}</h1>
        <p className="font-bold text-muted">{t("demoHelp")}</p>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <button
          disabled={busy}
          className="min-h-16 w-full bg-accent text-xl font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40"
          onClick={() => void start()}
        >
          {busy ? t("loading") : t("demoStart")}
        </button>
        <a href={signupUrl()} className="flex min-h-11 items-center justify-center font-bold underline">{t("demoOwn")}</a>
      </div>
    </Shell>
  );
}

/** A thin strip over the demo store, so nobody mistakes it for a real shop. */
function DemoBar() {
  const { t } = useLang();
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-x-3 bg-accent px-3 py-1 text-sm font-bold text-on-accent">
      <span>{t("demoBar")}</span>
      <a href={signupUrl()} className="underline">{t("demoOwn")} →</a>
    </div>
  );
}

const errorKey: Record<Exclude<SignInResult, "ok">, StringKey> = {
  wrong_pin: "wrongPin",
  locked: "pinLocked",
  needs_online: "needsOnline",
};

function PinScreen({ overlay, demo }: { overlay: boolean; demo: DemoInfo | null }) {
  const { lang, t, toggle } = useLang();
  const demoPin = (id: string) => demo?.staff?.find((s) => s.id === id)?.pin;
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void refreshStaff().then((s) => {
      if (!cancelled) setStaff(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    setError("");
    const result = await signIn(selected, pin);
    setBusy(false);
    setPin("");
    if (result !== "ok") setError(t(errorKey[result]));
  }, [selected, pin, busy, t]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, submit]);

  return (
    <Shell lang={lang} toggle={toggle} overlay={overlay}>
      {!selected ? (
        <div className="mx-auto mt-6 max-w-2xl">
          <h1 className="mb-4 text-3xl font-black">{demo?.demo ? t("demoWho") : t("whoIs")}</h1>
          {error && <p role="alert" className="mb-3 font-bold text-hot">{error}</p>}
          {staff === null ? (
            <p className="font-bold text-muted">{t("loading")}</p>
          ) : staff.length === 0 ? (
            <p className="font-bold text-muted">{t("firstLoad")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const pinForDemo = demoPin(s.id);
                    setError("");
                    if (pinForDemo) {
                      // The demo signs in with one tap; the PIN is shown so visitors see how it works.
                      setBusy(true);
                      void signIn(s, pinForDemo).then((result) => {
                        setBusy(false);
                        if (result !== "ok") setError(t(errorKey[result]));
                      });
                      return;
                    }
                    setSelected(s);
                    setPin("");
                  }}
                  disabled={busy}
                  className="tile-press min-h-28 border-[3px] border-line bg-panel p-3 text-left"
                >
                  <span className="block text-xl font-black">{s.name}</span>
                  <span className="font-bold text-muted">{t(s.role)}</span>
                  {demoPin(s.id) && <span className="mt-1 block text-sm font-bold">{t("demoPin")}: {demoPin(s.id)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto mt-2 max-w-xs space-y-3">
          <button className="min-h-11 font-bold underline" onClick={() => setSelected(null)}>
            ← {t("changeUser")}
          </button>
          <h1 className="text-2xl font-black">{selected.name}</h1>
          <div data-testid="pin-dots" aria-label={t("enterPin")} className="flex h-14 items-center justify-center gap-3 border-[3px] border-line bg-panel">
            {pin.length === 0 ? (
              <span className="font-bold text-muted">{t("enterPin")}</span>
            ) : (
              [...pin].map((_, i) => <span key={i} className="h-4 w-4 rounded-full bg-text" />)
            )}
          </div>
          {error && <p role="alert" className="font-bold text-hot">{error}</p>}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} className="tile-press h-16 border-[3px] border-line bg-panel text-2xl font-black" onClick={() => setPin((p) => (p.length < 6 ? p + d : p))}>
                {d}
              </button>
            ))}
            <button aria-label={t("backspace")} className="tile-press h-16 border-[3px] border-line bg-panel text-2xl font-black" onClick={() => setPin((p) => p.slice(0, -1))}>
              ⌫
            </button>
            <button className="tile-press h-16 border-[3px] border-line bg-panel text-2xl font-black" onClick={() => setPin((p) => (p.length < 6 ? p + "0" : p))}>
              0
            </button>
            <button aria-label={t("unlock")} disabled={pin.length < 4 || busy} className="h-16 bg-accent text-2xl font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40" onClick={() => void submit()}>
              ✓
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function Gate() {
  const auth = useSyncExternalStore(subscribeAuth, getAuth);
  const [failed, setFailed] = useState(false);
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    initAuth().catch(() => setFailed(true));
    void getDemo().then(setDemo);
  }, []);

  useEffect(() => {
    if (auth.status !== "paired" || !demo) return;
    void (demo.demo ? clearDemoTill().catch(() => undefined) : Promise.resolve()).then(startSync);
  }, [auth.status, demo]);

  // The demo signs in as the owner on first load, so visitors see everything. Locking still shows all staff.
  const [autoSignedIn, setAutoSignedIn] = useState(false);
  useEffect(() => {
    const owner = demo?.staff?.find((s) => s.role === "owner");
    // After an hourly reset the device reconnects, and should sign in again by itself.
    if (auth.status === "unpaired" && autoSignedIn) setAutoSignedIn(false);
    if (!demo?.demo || !owner || auth.status !== "paired" || auth.user || autoSignedIn) return;
    setAutoSignedIn(true);
    void refreshStaff().then(() => signIn({ id: owner.id, name: owner.name, role: owner.role }, owner.pin));
  }, [demo, auth.status, auth.user, autoSignedIn]);

  // The demo never locks: if anything locks it, the same person is signed straight back in.
  useEffect(() => {
    if (!demo?.demo || !auth.user || !auth.locked) return;
    const pin = demo.staff?.find((s) => s.id === auth.user?.id)?.pin;
    if (pin) void signIn({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, pin);
  }, [demo, auth.user, auth.locked]);

  const active = Boolean(auth.user) && !auth.locked && !demo?.demo;
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(lock, IDLE_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, IDLE_LOCK_MS);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [active]);

  if (failed) {
    return <div role="alert" className="flex h-full items-center justify-center p-8 text-center text-xl font-bold">{strings[saved<Lang>("lang", "bn")].dbError}</div>;
  }
  if (auth.status === "loading") return null;
  if (auth.status === "unpaired") {
    if (!demo) return null;
    return demo.demo ? <DemoStart /> : <PairScreen />;
  }
  if (!demo?.demo) {
    if (!auth.user) return <PinScreen overlay={false} demo={demo} />;
    // The till stays mounted under the lock screen, so a bill in progress survives switching staff.
    return (
      <>
        <App user={auth.user} />
        {auth.locked && <PinScreen overlay demo={demo} />}
      </>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <DemoBar />
      <div className="relative min-h-0 flex-1">
        {auth.user ? <App user={auth.user} demo /> : <p className="p-8 text-center text-xl font-bold text-muted">{strings[saved<Lang>("lang", "bn")].loading}</p>}
      </div>
    </div>
  );
}
