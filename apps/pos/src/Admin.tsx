import { formatTaka, PLANS, SUBSCRIPTION_METHODS, type PlatformLog, type PlatformPayment, type PlatformStore, type SubscriptionMethod } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import { AdminInbox } from "./AdminInbox";

const row = "flex flex-wrap items-center justify-between gap-3 border-[3px] border-line bg-panel p-3";
const small = "min-h-11 border-[3px] border-line px-3 font-black";

const SESSION_KEY = "lalcha-platform-session";
const readSession = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Your team's page, served only on the admin address. English only. The session ends when this tab closes. */
export function Admin() {
  const [key, setKey] = useState(readSession);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [tab, setTab] = useState<"inbox" | "payments" | "stores" | "log">("inbox");
  const [unread, setUnread] = useState(0);
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [stores, setStores] = useState<PlatformStore[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [log, setLog] = useState<PlatformLog[]>([]);
  const [open, setOpen] = useState<PlatformStore | null>(null);
  const [error, setError] = useState("");
  const [shownPin, setShownPin] = useState("");

  const headers = { "x-platform-session": key };

  const loadStores = useCallback(async (q: string, p: number) => {
    const res = await fetch(`/v1/platform/stores?q=${encodeURIComponent(q)}&page=${p}`, { headers: { "x-platform-session": key } });
    if (!res.ok) return false;
    const body = (await res.json()) as { stores: PlatformStore[]; hasMore: boolean };
    setStores((old) => (p === 1 ? body.stores : [...old, ...body.stores]));
    setHasMore(body.hasMore);
    setPage(p);
    return true;
  }, [key]);

  async function load() {
    setError("");
    try {
      const [p, l] = await Promise.all([fetch("/v1/platform/payments", { headers }), fetch("/v1/platform/log", { headers })]);
      if (p.status === 401) {
        signOutLocally();
        return;
      }
      if (!p.ok || !l.ok || !(await loadStores(query, 1))) throw new Error();
      setPayments(((await p.json()) as { payments: PlatformPayment[] }).payments);
      setLog(((await l.json()) as { log: PlatformLog[] }).log);
      setAuthed(true);
    } catch {
      setError("Could not load data.");
    }
  }

  function signOutLocally() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* storage may be blocked */ }
    setKey("");
    setAuthed(false);
  }

  // A session kept in this tab signs straight back in after a refresh.
  useEffect(() => {
    if (key && !authed) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function requestCode() {
    setError("");
    const res = await fetch("/v1/platform/auth/request-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    if (!res?.ok) return setError("Enter a valid email.");
    const body = (await res.json()) as { devCode?: string };
    setDevCode(body.devCode ?? "");
    setCodeSent(true);
  }

  async function verify() {
    setError("");
    const res = await fetch("/v1/platform/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) }).catch(() => null);
    if (!res?.ok) return setError("That code is wrong or expired.");
    const body = (await res.json()) as { token: string };
    try {
      sessionStorage.setItem(SESSION_KEY, body.token);
    } catch { /* stays in memory only */ }
    setKey(body.token);
  }

  async function signOut() {
    await fetch("/v1/platform/sign-out", { method: "POST", headers }).catch(() => null);
    signOutLocally();
  }

  useEffect(() => {
    if (!authed) return;
    const timer = window.setTimeout(() => void loadStores(query, 1), 250);
    return () => window.clearTimeout(timer);
  }, [query, authed, loadStores]);

  async function post(path: string, body?: unknown) {
    setError("");
    const res = await fetch(path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) {
      setError("That action failed. Refresh and check.");
      return null;
    }
    return res.json().catch(() => ({}));
  }

  async function storeAction(path: string, body?: unknown) {
    if (!open) return;
    const result = (await post(`/v1/platform/stores/${open.id}/${path}`, body)) as { pin?: string } | null;
    if (result?.pin) setShownPin(result.pin);
    await load();
  }

  useEffect(() => {
    if (open) setOpen(stores.find((s) => s.id === open.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores]);

  if (!authed) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-4">
        <form className="w-full max-w-sm space-y-3 border-[3px] border-line bg-panel p-5" onSubmit={(e) => { e.preventDefault(); void (codeSent ? verify() : requestCode()); }}>
          <h1 className="text-2xl font-black">Lalcha superadmin</h1>
          <label className="block font-bold">Email<input autoFocus required type="email" autoComplete="username" disabled={codeSent} value={email} onChange={(e) => setEmail(e.target.value.trim().toLowerCase())} className="mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 font-bold" /></label>
          {codeSent && (
            <>
              <p className="font-bold text-muted">If this email is an admin, a code is on its way.</p>
              {devCode && <p className="bg-accent p-2 font-black text-on-accent">Development code: {devCode}</p>}
              <label className="block font-bold">6-digit code<input autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 font-bold" /></label>
            </>
          )}
          {error && <p role="alert" className="font-bold text-hot">{error}</p>}
          <button className="min-h-14 w-full bg-[#12130f] text-lg font-black text-accent ring-2 ring-line">{codeSent ? "Sign in" : "Send code"}</button>
          {codeSent && <button type="button" className="min-h-11 w-full font-bold underline" onClick={() => { setCodeSent(false); setCode(""); setDevCode(""); }}>Use another email</button>}
        </form>
      </div>
    );
  }

  const pending = payments.filter((p) => p.status === "pending");
  const decided = payments.filter((p) => p.status !== "pending");

  return (
    <main className="h-full overflow-y-auto bg-bg p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-black">Lalcha superadmin</h1>
          <button className={small} onClick={() => void signOut()}>Sign out</button>
        </div>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="grid grid-cols-2 border-[3px] border-line font-black sm:grid-cols-4">
          {(["inbox", "payments", "stores", "log"] as const).map((v) => (
            <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)} className={`min-h-12 capitalize ${tab === v ? "bg-text text-bg" : "bg-panel"}`}>
              {v === "inbox" ? `Inbox${unread ? ` (${unread})` : ""}` : v === "payments" ? `Payments (${pending.length})` : v === "stores" ? "Stores" : "Activity"}
            </button>
          ))}
        </div>

        {tab === "inbox" && <AdminInbox session={key} onUnread={setUnread} />}

        {tab === "payments" && (
          <section className="space-y-2">
            <p className="font-bold text-muted">Approve only after finding this transaction ID and amount in your own bKash or Nagad account.</p>
            {pending.length === 0 && <p className="font-bold text-muted">Nothing is waiting.</p>}
            {pending.map((p) => (
              <div key={p.id} className={row}>
                <span>
                  <span className="block text-lg font-black">{p.storeName} · {p.subdomain}</span>
                  <span className="block font-bold text-muted">{p.plan} · {p.months} month(s) · {p.method} · <span data-testid="trx">{p.ref}</span></span>
                </span>
                <span className="text-2xl font-black">{formatTaka(p.amountPoisha, "en")}</span>
                <span className="flex gap-2">
                  <button className={small} onClick={() => void post(`/v1/platform/payments/${p.storeId}/${p.id}/reject`).then(load)}>Reject</button>
                  <button className="min-h-11 bg-accent px-4 font-black text-on-accent" onClick={() => void post(`/v1/platform/payments/${p.storeId}/${p.id}/approve`).then(load)}>Approve</button>
                </span>
              </div>
            ))}
            {decided.length > 0 && <h2 className="pt-2 text-xl font-black">Decided</h2>}
            {decided.map((p) => <div key={p.id} className={row}><span className="font-bold">{p.subdomain} · {p.ref}</span><span className="font-black">{formatTaka(p.amountPoisha, "en")} · {p.status}</span></div>)}
          </section>
        )}

        {tab === "stores" && (
          <section className="space-y-2">
            <input aria-label="Search stores" placeholder="Search name, address, email or phone" value={query} onChange={(e) => setQuery(e.target.value)} className="h-13 w-full border-[3px] border-line bg-panel px-3 font-bold" />
            {stores.map((s) => (
              <button key={s.id} className={`${row} w-full text-left`} onClick={() => { setOpen(s); setShownPin(""); }}>
                <span><span className="block text-lg font-black">{s.name} · {s.subdomain}</span><span className="block font-bold text-muted">{s.owner ?? "—"} · {s.email ?? s.phone ?? "—"}</span></span>
                <span className="text-right font-bold"><span className="block font-black">{s.plan} · {s.suspended ? "suspended" : s.status}</span><span className="block text-muted">{s.salesLast30} sales in 30 days</span></span>
              </button>
            ))}
            {hasMore && <button className={`${small} w-full`} onClick={() => void loadStores(query, page + 1)}>Load more</button>}
          </section>
        )}

        {tab === "log" && (
          <section className="space-y-2">
            {log.map((l) => <div key={l.id} className={row}><span className="font-black">{l.action} · {l.storeName ?? "—"}<span className="block text-sm font-bold text-muted">{l.actor ?? "—"}</span></span><span className="font-bold text-muted">{l.detail ?? ""} {new Date(l.at).toLocaleString("en-GB")}</span></div>)}
          </section>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={open.name}>
          <div className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4">
            <h2 className="text-2xl font-black">{open.name}</h2>
            <p className="font-bold text-muted">{open.subdomain} · {open.owner ?? "—"} · {open.email ?? "—"} · {open.phone ?? "—"}</p>
            <p className="font-bold">Status: {open.suspended ? "suspended" : open.status} · access until {open.accessUntil ? new Date(open.accessUntil).toLocaleDateString("en-GB") : "—"}</p>
            <p className="font-bold">{open.devices} devices · {open.staff} staff · {open.salesLast30} sales in 30 days · last sale {open.lastSaleAt ? new Date(open.lastSaleAt).toLocaleDateString("en-GB") : "never"}</p>
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30].map((days) => <button key={days} className={small} onClick={() => void storeAction("extend", { days })}>+{days} days</button>)}
            </div>
            <label className="block font-bold">Plan
              <select value={open.plan} onChange={(e) => void storeAction("plan", { plan: e.target.value })} className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 font-bold">
                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <ManualPayment plan={open.plan} onSave={(body) => storeAction("subscription", body)} />
            <label className="block font-bold">Support note
              <textarea maxLength={1000} defaultValue={open.note ?? ""} onBlur={(e) => { if (e.target.value !== (open.note ?? "")) void storeAction("note", { note: e.target.value }); }} className="mt-1 h-24 w-full border-[3px] border-line bg-bg p-2 font-bold" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className={small} onClick={() => void storeAction("suspend", { suspended: !open.suspended })}>{open.suspended ? "Restore store" : "Suspend store"}</button>
              <button className={small} onClick={() => void storeAction("reset-owner-pin")}>Reset owner PIN</button>
            </div>
            {shownPin && <p data-testid="new-pin" className="bg-accent p-3 text-xl font-black text-on-accent">New owner PIN: {shownPin}. Give it to the verified owner; it won't be shown again.</p>}
            <button className={`${small} w-full`} onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** Records a payment made outside the app (cash, bank, a phone deal) and extends access straight away. */
function ManualPayment({ plan, onSave }: { plan: string; onSave: (body: unknown) => Promise<void> }) {
  const known = PLANS.find((p) => p.id === plan);
  const [planId, setPlanId] = useState<string>(known?.id ?? PLANS[0].id);
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState<SubscriptionMethod>("cash");
  const [amount, setAmount] = useState(String(((known ?? PLANS[0]).monthlyPoisha / 100) * 1));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 font-bold";
  const suggest = (id: string, m: number) => setAmount(String(((PLANS.find((p) => p.id === id)?.monthlyPoisha ?? 0) / 100) * m));
  return (
    <form
      className="space-y-2 border-[3px] border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        void onSave({ plan: planId, months, method, amountPoisha: Math.round(Number(amount) * 100), ref: ref.trim() }).finally(() => {
          setBusy(false);
          setRef("");
        });
      }}
    >
      <h3 className="text-lg font-black">Record a payment</h3>
      <p className="text-sm font-bold text-muted">Adds the months to this store's access now and logs it under your email.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block font-bold">Plan<select value={planId} onChange={(e) => { setPlanId(e.target.value); suggest(e.target.value, months); }} className={field}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block font-bold">Months<input type="number" min={1} max={36} required value={months} onChange={(e) => { const m = Math.max(1, Math.min(36, Number(e.target.value) || 1)); setMonths(m); suggest(planId, m); }} className={field} /></label>
        <label className="block font-bold">Paid by<select value={method} onChange={(e) => setMethod(e.target.value as SubscriptionMethod)} className={field}>{SUBSCRIPTION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="block font-bold">Amount (৳)<input type="number" min={0} step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} className={field} /></label>
      </div>
      <label className="block font-bold">Reference (optional)<input maxLength={64} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Receipt no., bank ref, or a note" className={field} /></label>
      <button disabled={busy} className="min-h-12 w-full bg-accent font-black text-on-accent disabled:opacity-40">Add {months} month(s)</button>
    </form>
  );
}
