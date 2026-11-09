import { formatTaka, type PlatformPayment, type PlatformStore } from "@lalcha/domain";
import { useState } from "react";

/** Your team's page. English only, and the key lives in memory so it's gone on refresh. */
export function Admin() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [stores, setStores] = useState<PlatformStore[]>([]);
  const [error, setError] = useState("");

  const headers = { "x-platform-key": key };

  async function load() {
    setError("");
    try {
      const [p, s] = await Promise.all([fetch("/v1/platform/payments", { headers }), fetch("/v1/platform/stores", { headers })]);
      if (p.status === 401) {
        setError("That key is not correct.");
        return;
      }
      if (!p.ok || !s.ok) throw new Error();
      setPayments(((await p.json()) as { payments: PlatformPayment[] }).payments);
      setStores(((await s.json()) as { stores: PlatformStore[] }).stores);
      setAuthed(true);
    } catch {
      setError("Could not load data.");
    }
  }

  async function decide(p: PlatformPayment, action: "approve" | "reject") {
    setError("");
    const res = await fetch(`/v1/platform/payments/${p.storeId}/${p.id}/${action}`, { method: "POST", headers }).catch(() => null);
    if (!res?.ok) setError("That action failed. Refresh and check the payment.");
    await load();
  }

  if (!authed) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-4">
        <form
          className="w-full max-w-sm space-y-3 border-[3px] border-line bg-panel p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <h1 className="text-2xl font-black">Platform admin</h1>
          <label className="block font-bold">
            Admin key
            <input autoFocus required type="password" value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 font-bold" />
          </label>
          {error && <p role="alert" className="font-bold text-hot">{error}</p>}
          <button className="min-h-14 w-full bg-[#12130f] text-lg font-black text-accent ring-2 ring-line">Sign in</button>
        </form>
      </div>
    );
  }

  const pending = payments.filter((p) => p.status === "pending");
  const decided = payments.filter((p) => p.status !== "pending");
  const row = "flex flex-wrap items-center justify-between gap-3 border-[3px] border-line bg-panel p-3";

  return (
    <main className="h-full overflow-y-auto bg-bg p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-3xl font-black">Platform admin</h1>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}

        <section className="space-y-2">
          <h2 className="text-xl font-black">Payments to check ({pending.length})</h2>
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
                <button className="min-h-12 border-[3px] border-line px-4 font-black" onClick={() => void decide(p, "reject")}>Reject</button>
                <button className="min-h-12 bg-accent px-4 font-black text-on-accent" onClick={() => void decide(p, "approve")}>Approve</button>
              </span>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-black">Stores ({stores.length})</h2>
          {stores.map((s) => (
            <div key={s.id} className={row}>
              <span>
                <span className="block text-lg font-black">{s.name} · {s.subdomain}</span>
                <span className="block font-bold text-muted">{s.owner ?? "—"} · {s.phone ?? "—"}</span>
              </span>
              <span className="text-right font-bold">
                <span className="block font-black">{s.plan} · {s.status}</span>
                <span className="block text-muted">{s.accessUntil ? new Date(s.accessUntil).toLocaleDateString("en-GB") : "—"}</span>
              </span>
            </div>
          ))}
        </section>

        {decided.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xl font-black">Decided payments</h2>
            {decided.map((p) => (
              <div key={p.id} className={row}>
                <span className="font-bold">{p.subdomain} · {p.ref}</span>
                <span className="font-black">{formatTaka(p.amountPoisha, "en")} · {p.status}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
