import { BILLING_METHODS, formatNumber, formatTaka, planById, PLANS, subscriptionState, type BillingMethod, type BillingResponse, type Lang } from "@lalcha/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
const MONTHS = [1, 3, 6, 12];

export function BillingScreen({ lang, t, online, onChanged }: { lang: Lang; t: T; online: boolean; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState<BillingMethod>("bkash");
  const [ref, setRef] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentId = useRef(uuidv7());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/v1/billing");
      if (!res.ok) throw new Error();
      setData((await res.json()) as BillingResponse);
    } catch {
      setError(t("saveFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const sub = data?.subscription ?? null;
  const state = sub ? subscriptionState(sub) : null;
  const selected = planById(plan ?? sub?.plan ?? "") ?? PLANS[0];
  const amount = selected.monthlyPoisha * months;
  const when = (iso: string) => new Date(iso).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB");
  const statusKey = { trial: "subTrial", active: "subActive", grace: "subGrace", expired: "subExpired" } as const;
  const paymentKey = { pending: "paymentPending", approved: "paymentApproved", rejected: "paymentRejected" } as const;
  const payTo = data?.payTo?.[method];

  async function submit() {
    if (busy || !ref.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/v1/billing/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paymentId.current, plan: selected.id, months, method, ref: ref.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === "duplicate_trx" ? t("duplicate_trx") : t("saveFailed"));
        return;
      }
      paymentId.current = uuidv7();
      setRef("");
      await Promise.all([load(), onChanged()]);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {sub && state && (
          <div className="bg-accent p-3 text-on-accent">
            <p className="text-lg font-black">{planById(sub.plan)?.name ?? sub.plan} · <span data-testid="sub-status">{t(statusKey[state.status])}</span></p>
            <p data-testid="sub-until" className="text-3xl font-black">{t("accessUntil")}: {when(sub.accessUntil)}</p>
          </div>
        )}

        <h2 className="text-2xl font-black">{t("choosePlan")}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {PLANS.map((p) => (
            <button
              key={p.id}
              aria-pressed={selected.id === p.id}
              onClick={() => setPlan(p.id)}
              className={`border-[3px] p-3 text-left ${selected.id === p.id ? "border-hot bg-panel" : "border-line bg-panel"}`}
            >
              <span className="block text-xl font-black">{p.name}</span>
              <span className="block text-3xl font-black">{formatTaka(p.monthlyPoisha, lang)}</span>
              <span className="block font-bold text-muted">{t("perMonth")} · {formatNumber(p.maxDevices, lang)} {t("devices")}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 border-[3px] border-line font-black">
          {MONTHS.map((m) => (
            <button key={m} aria-pressed={months === m} onClick={() => setMonths(m)} className={`min-h-12 ${months === m ? "bg-text text-bg" : "bg-panel"}`}>
              {formatNumber(m, lang)} {t("months")}
            </button>
          ))}
        </div>

        <section className="space-y-3 border-[3px] border-line bg-panel p-3">
          <div className="flex items-end justify-between">
            <span className="text-lg font-black">{t("total")}</span>
            <span data-testid="billing-amount" className="text-4xl font-black">{formatTaka(amount, lang)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BILLING_METHODS.map((m) => (
              <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line font-black ${method === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
            ))}
          </div>
          {data && !data.payTo ? (
            <p role="alert" className="font-bold text-hot">{t("billing_unavailable")}</p>
          ) : (
            <>
              <p className="font-bold">{t("sendMoneyTo")}: <span data-testid="pay-to" className="font-black">{payTo}</span></p>
              <label className="block font-bold">
                {t("ref")}
                <input maxLength={64} value={ref} onChange={(e) => setRef(e.target.value)} className="mt-1 h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-black" />
              </label>
              {error && <p role="alert" className="font-bold text-hot">{error}</p>}
              <button disabled={busy || !online || !ref.trim()} onClick={() => void submit()} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("submitPayment")}</button>
              <p className="font-bold text-muted">{t("paymentReview")}</p>
            </>
          )}
        </section>

        {data && data.payments.length > 0 && (
          <section>
            <h2 className="mb-1 text-xl font-black">{t("paymentHistory")}</h2>
            <ul className="space-y-2">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 font-bold">
                  <span className="min-w-0">
                    <span className="block truncate font-black">{planById(p.plan)?.name ?? p.plan} · {formatNumber(p.months, lang)} {t("months")}</span>
                    <span className="block truncate text-sm text-muted">{when(p.createdAt)} · {t(p.method)} · {p.ref}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-black">{formatTaka(p.amountPoisha, lang)}</span>
                    <span className={`block text-sm ${p.status === "rejected" ? "text-hot" : "text-muted"}`}>{t(paymentKey[p.status])}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
