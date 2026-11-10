import type { StaffMember } from "@lalcha/domain";
import { useEffect, useState } from "react";
import type { StringKey } from "./i18n";
import { forgetPin } from "./local";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const primary = "min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40";
const pinInput = (value: string, set: (v: string) => void, label: string) => (
  <label className="block font-bold">
    {label}
    <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ""))} className={`${field} tracking-[0.4em]`} />
  </label>
);

/** Server error codes that have their own message; anything else is a plain "couldn't save". */
async function errorOf(res: Response | null, t: T) {
  if (!res) return t("resetNeedsOnline");
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const map: Record<string, StringKey> = { invalid_code: "badCode", wrong_pin: "wrongPin", weak_pin: "weak_pin", invalid_pin: "invalid_pin", invalid_email: "invalid_email", duplicate_email: "duplicate_email", forbidden: "forbidden" };
  return t(map[body?.error ?? ""] ?? "saveFailed");
}

/**
 * Forgot PIN, from the PIN screen: email → code → new PIN. Owners and managers only, since they are
 * the ones with an email on file; a cashier's PIN is reset by them in Staff.
 */
export function ForgotPin({ person, t, onDone, onCancel }: { person: StaffMember; t: T; onDone: (pin: string) => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (person.role === "cashier") {
    return (
      <div className="space-y-3">
        <p className="font-bold">{t("resetCashierHelp")}</p>
        <button className="min-h-12 w-full border-[3px] border-line font-black" onClick={onCancel}>← {t("backToPin")}</button>
      </div>
    );
  }

  async function send() {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError("");
    const res = await apiFetch("/v1/auth/pin-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim() }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(await errorOf(res, t));
    setDevCode(((await res.json()) as { devCode?: string }).devCode ?? "");
    setSent(true);
  }

  async function save() {
    if (busy) return;
    if (pin !== again) return setError(t("pinMismatch"));
    setBusy(true);
    setError("");
    const res = await apiFetch("/v1/auth/pin-reset/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), code, pin }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(await errorOf(res, t));
    const { userId } = (await res.json()) as { userId: string };
    await forgetPin(userId);
    onDone(pin);
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void (sent ? save() : send()); }}>
      <h2 className="text-2xl font-black">{t("resetTitle")}</h2>
      {!sent ? (
        <>
          <p className="font-bold text-muted">{t("resetHelp")}</p>
          <label className="block font-bold">{t("email")}<input autoFocus type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>
          {error && <p role="alert" className="font-bold text-hot">{error}</p>}
          <button disabled={busy || !email.trim()} className={primary}>{t("sendCode")}</button>
        </>
      ) : (
        <>
          <p role="status" className="font-bold">{t("codeSentEmail")}</p>
          {devCode && <p className="bg-accent p-2 font-black text-on-accent">{t("devCode")}: {devCode}</p>}
          <label className="block font-bold">{t("code")}<input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} tracking-[0.3em]`} /></label>
          {pinInput(pin, setPin, t("newPinLabel"))}
          {pinInput(again, setAgain, t("confirmPin"))}
          {error && <p role="alert" className="font-bold text-hot">{error}</p>}
          <button disabled={busy || code.length !== 6 || pin.length < 4 || again.length < 4} className={primary}>{t("setNewPin")}</button>
          <button type="button" disabled={busy} className="min-h-11 w-full font-bold underline" onClick={() => { setSent(false); setCode(""); }}>{t("sendCode")}</button>
        </>
      )}
      <button type="button" className="min-h-12 w-full border-[3px] border-line font-black" onClick={onCancel}>← {t("backToPin")}</button>
    </form>
  );
}

/** Your own sign-in details: change your PIN, and (owners and managers) your email. */
export function AccountScreen({ userId, role, t, online }: { userId: string; role: string; t: T; online: boolean }) {
  const [me, setMe] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [email, setEmail] = useState("");
  const [emailPin, setEmailPin] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (online) void apiFetch("/v1/auth/me").then(async (r) => (r.ok ? setMe(await r.json()) : undefined)).catch(() => undefined);
  }, [online]);

  async function changePin() {
    if (pin !== again) return setPinMessage(t("pinMismatch"));
    setBusy(true);
    const res = await apiFetch("/v1/auth/me/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPin: current, pin }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setPinMessage(await errorOf(res, t));
    await forgetPin(userId);
    setCurrent("");
    setPin("");
    setAgain("");
    setPinMessage(t("pinChanged"));
  }

  async function requestEmail() {
    setBusy(true);
    const res = await apiFetch("/v1/auth/me/email/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), currentPin: emailPin }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setEmailMessage(await errorOf(res, t));
    setDevCode(((await res.json()) as { devCode?: string }).devCode ?? "");
    setCodeSent(true);
    setEmailMessage(t("codeSentEmail"));
  }

  async function confirmEmail() {
    setBusy(true);
    const res = await apiFetch("/v1/auth/me/email/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), code }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setEmailMessage(await errorOf(res, t));
    setMe((m) => (m ? { ...m, email: email.trim().toLowerCase() } : m));
    setCodeSent(false);
    setCode("");
    setEmail("");
    setEmailPin("");
    setEmailMessage(t("emailChanged"));
  }

  const box = "space-y-3 border-[3px] border-line bg-panel p-4";
  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-lg space-y-3">
        <section className={box}>
          <h1 className="text-2xl font-black">{t("account")}</h1>
          <p className="font-bold text-muted">{t("accountHelp")}</p>
          {me && <p className="text-lg font-black">{me.name} · <span className="font-mono">{me.email ?? t("noEmailYet")}</span></p>}
          {!online && <p role="alert" className="font-bold text-hot">{t("resetNeedsOnline")}</p>}
        </section>

        <form className={box} onSubmit={(e) => { e.preventDefault(); void changePin(); }}>
          <h2 className="text-xl font-black">{t("changePin")}</h2>
          {pinInput(current, setCurrent, t("currentPin"))}
          {pinInput(pin, setPin, t("newPinLabel"))}
          {pinInput(again, setAgain, t("confirmPin"))}
          {pinMessage && <p role="status" className="font-bold">{pinMessage}</p>}
          <button disabled={!online || busy || current.length < 4 || pin.length < 4 || again.length < 4} className={primary}>{t("changePin")}</button>
        </form>

        {role !== "cashier" && (
          <form className={box} onSubmit={(e) => { e.preventDefault(); void (codeSent ? confirmEmail() : requestEmail()); }}>
            <h2 className="text-xl font-black">{t("changeEmail")}</h2>
            <label className="block font-bold">{t("newEmail")}<input type="email" autoComplete="email" maxLength={254} disabled={codeSent} value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>
            {!codeSent ? (
              pinInput(emailPin, setEmailPin, t("currentPin"))
            ) : (
              <>
                {devCode && <p className="bg-accent p-2 font-black text-on-accent">{t("devCode")}: {devCode}</p>}
                <label className="block font-bold">{t("code")}<input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} tracking-[0.3em]`} /></label>
              </>
            )}
            {emailMessage && <p role="status" className="font-bold">{emailMessage}</p>}
            <button disabled={!online || busy || !email.trim() || (codeSent ? code.length !== 6 : emailPin.length < 4)} className={primary}>{codeSent ? t("save") : t("sendCodeToNew")}</button>
            {codeSent && <button type="button" className="min-h-11 w-full font-bold underline" onClick={() => { setCodeSent(false); setCode(""); setEmailMessage(""); }}>{t("cancel")}</button>}
          </form>
        )}
      </div>
    </main>
  );
}
