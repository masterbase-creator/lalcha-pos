import { EXPENSE_CATEGORIES, EXPENSE_LABELS, formatTaka, type CashbookEntry, type ExpenseCategory, type ExpenseRecord, type Lang, type ProfitLoss } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const bdToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const monthStart = () => `${bdToday().slice(0, 8)}01`;

/** Expenses, the cash book, and profit after expenses. Everything here needs the server. */
export function AccountsScreen({ lang, t, online }: { lang: Lang; t: T; online: boolean }) {
  const [tab, setTab] = useState<"expenses" | "cashbook" | "profitLoss">("profitLoss");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(bdToday);
  const [version, setVersion] = useState(0);
  const range = `from=${from}&to=${to}`;

  async function exportJournal() {
    const res = await apiFetch(`/v1/accounts/export?${range}`).catch(() => null);
    if (!res?.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `lalcha-journal-${from}-to-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex gap-2">
          {(["profitLoss", "cashbook", "expenses"] as const).map((x) => (
            <button key={x} aria-pressed={tab === x} onClick={() => setTab(x)} className={`min-h-12 flex-1 border-[3px] border-line font-black ${tab === x ? "bg-text text-bg" : "bg-panel"}`}>{t(x)}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="font-bold">{t("fromDate")}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
          <label className="font-bold">{t("toDate")}<input type="date" value={to} min={from} max={bdToday()} onChange={(e) => setTo(e.target.value)} className={field} /></label>
          <button disabled={!online} className="ml-auto min-h-12 border-[3px] border-line bg-panel px-3 font-black disabled:opacity-40" onClick={() => void exportJournal()}>⬇ {t("exportJournal")}</button>
        </div>
        {!online && <p role="alert" className="font-bold text-hot">{t("accountsNeedOnline")}</p>}
        {online && tab === "profitLoss" && <ProfitLossView key={`${range}-${version}`} range={range} lang={lang} t={t} />}
        {online && tab === "cashbook" && <Cashbook key={`${range}-${version}`} range={range} lang={lang} t={t} />}
        {online && tab === "expenses" && <Expenses key={range} range={range} lang={lang} t={t} onChanged={() => setVersion((v) => v + 1)} />}
      </div>
    </main>
  );
}

function useFetch<R>(url: string, t: T) {
  const [data, setData] = useState<R | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await apiFetch(url).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      return setError(body?.error === "invalid_range" ? t("invalid_range") : t("reportFailed"));
    }
    setError("");
    setData((await res.json()) as R);
  }, [url, t]);
  useEffect(() => void load(), [load]);
  return { data, error, load };
}

function ProfitLossView({ range, lang, t }: { range: string; lang: Lang; t: T }) {
  const { data, error } = useFetch<ProfitLoss>(`/v1/accounts/pnl?${range}`, t);
  const money = (p: number) => formatTaka(Math.round(p), lang);
  if (error) return <p role="alert" className="font-bold text-hot">{error}</p>;
  if (!data) return <p className="p-6 text-center font-bold text-muted">{t("loading")}</p>;
  const row = (label: string, value: number, opts: { minus?: boolean; strong?: boolean } = {}) => (
    <div className={`flex justify-between gap-3 py-1.5 ${opts.strong ? "border-t-[3px] border-line text-xl font-black" : "font-bold"}`}>
      <span>{label}</span>
      <span>{opts.minus && value ? "−" : ""}{money(value)}</span>
    </div>
  );
  const profit = data.netProfitPoisha >= 0;
  return (
    <section className="space-y-1 border-[3px] border-line bg-panel p-4">
      {row(t("plSales"), data.salesPoisha)}
      {row(t("plReturns"), data.returnsPoisha, { minus: true })}
      {row(t("plVat"), data.vatPoisha, { minus: true })}
      {row(t("plNetSales"), data.netSalesPoisha, { strong: true })}
      {row(t("plCogs"), data.costOfGoodsPoisha, { minus: true })}
      {row(t("plGross"), data.grossProfitPoisha, { strong: true })}
      {data.expenses.map((e) => row(EXPENSE_LABELS[e.category]?.[lang] ?? e.category, e.amountPoisha, { minus: true }))}
      {data.writeOffsPoisha > 0 && row(t("plWriteOffs"), data.writeOffsPoisha, { minus: true })}
      <div className={`mt-2 flex items-end justify-between p-3 ${profit ? "bg-accent text-on-accent" : "bg-hot text-white"}`}>
        <span className="text-lg font-black">{profit ? t("plNet") : t("plLoss")}</span>
        <span className="text-4xl font-black">{money(Math.abs(data.netProfitPoisha))}</span>
      </div>
    </section>
  );
}

function Cashbook({ range, lang, t }: { range: string; lang: Lang; t: T }) {
  const { data, error } = useFetch<{ entries: CashbookEntry[] }>(`/v1/accounts/cashbook?${range}`, t);
  if (error) return <p role="alert" className="font-bold text-hot">{error}</p>;
  if (!data) return <p className="p-6 text-center font-bold text-muted">{t("loading")}</p>;
  if (data.entries.length === 0) return <p className="p-6 text-center font-bold text-muted">{t("noEntries")}</p>;
  let balance = 0;
  const totalIn = data.entries.reduce((n, e) => n + e.inPoisha, 0);
  const totalOut = data.entries.reduce((n, e) => n + e.outPoisha, 0);
  return (
    <section className="overflow-x-auto border-[3px] border-line bg-panel">
      <table className="w-full min-w-[560px] text-left">
        <thead className="border-b-[3px] border-line">
          <tr className="font-black"><th className="p-2">{t("date")}</th><th className="p-2"></th><th className="p-2">{t("moneyInCol")}</th><th className="p-2">{t("moneyOutCol")}</th><th className="p-2 text-right">{t("balance")}</th></tr>
        </thead>
        <tbody>
          {data.entries.map((e, i) => {
            balance += e.inPoisha - e.outPoisha;
            return (
              <tr key={i} className="border-b border-line/20 font-bold">
                <td className="p-2 whitespace-nowrap">{new Date(e.at).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short" })}</td>
                <td className="p-2">{e.detail} <span className="text-sm text-muted">· {t(e.method as StringKey) ?? e.method}</span></td>
                <td className="p-2 text-[#1f7a55]">{e.inPoisha ? formatTaka(e.inPoisha, lang) : ""}</td>
                <td className="p-2 text-hot">{e.outPoisha ? formatTaka(e.outPoisha, lang) : ""}</td>
                <td className="p-2 text-right">{formatTaka(balance, lang)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-[3px] border-line font-black">
          <tr><td className="p-2" colSpan={2}>{t("total")}</td><td className="p-2">{formatTaka(totalIn, lang)}</td><td className="p-2">{formatTaka(totalOut, lang)}</td><td className="p-2 text-right">{formatTaka(totalIn - totalOut, lang)}</td></tr>
        </tfoot>
      </table>
    </section>
  );
}

function Expenses({ range, lang, t, onChanged }: { range: string; lang: Lang; t: T; onChanged: () => void }) {
  const { data, error, load } = useFetch<{ expenses: ExpenseRecord[] }>(`/v1/expenses?${range}`, t);
  const [category, setCategory] = useState<ExpenseCategory>("rent");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ExpenseRecord["method"]>("cash");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [spentOn, setSpentOn] = useState(bdToday);
  const [message, setMessage] = useState("");

  async function add() {
    const amountPoisha = Math.round(Number(amount) * 100);
    if (!(amountPoisha > 0)) return setMessage(t("badNumber"));
    if ((method === "bkash" || method === "nagad") && !ref.trim()) return setMessage(t("payment_ref_required"));
    const res = await apiFetch("/v1/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: uuidv7(), category, amountPoisha, method, ref: ref.trim() || null, note: note.trim() || null, spentOn }),
    }).catch(() => null);
    if (!res?.ok) return setMessage(t("saveFailed"));
    setMessage("");
    setAmount("");
    setRef("");
    setNote("");
    await load();
    onChanged();
  }

  async function remove(id: string) {
    await apiFetch(`/v1/expenses/${id}/void`, { method: "POST" }).catch(() => null);
    await load();
    onChanged();
  }

  const total = data?.expenses.reduce((n, e) => n + e.amountPoisha, 0) ?? 0;
  return (
    <section className="space-y-3">
      <form className="space-y-2 border-[3px] border-line bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <h2 className="text-xl font-black">{t("addExpense")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-bold">
            {t("expenseCategory")}
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={field}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_LABELS[c][lang]}</option>)}
            </select>
          </label>
          <label className="block font-bold">{t("amount")}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
          <label className="block font-bold">{t("spentOn")}<input type="date" max={bdToday()} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className={field} /></label>
          <label className="block font-bold">{t("noteOptional")}<input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={field} /></label>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {(["cash", "bkash", "nagad", "bank", "card"] as const).map((m) => (
            <button type="button" key={m} aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line text-sm font-black ${method === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
          ))}
        </div>
        {(method === "bkash" || method === "nagad") && <label className="block font-bold">{t("ref")}<input maxLength={64} value={ref} onChange={(e) => setRef(e.target.value)} className={field} /></label>}
        {message && <p role="alert" className="font-bold text-hot">{message}</p>}
        <button className="min-h-13 w-full bg-[#12130f] text-lg font-black text-accent ring-2 ring-line">{t("addExpense")}</button>
      </form>
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
      {data?.expenses.length === 0 && <p className="p-6 text-center font-bold text-muted">{t("noExpenses")}</p>}
      {data && data.expenses.length > 0 && (
        <div className="flex justify-between bg-accent p-3 text-xl font-black text-on-accent"><span>{t("totalExpenses")}</span><span>{formatTaka(total, lang)}</span></div>
      )}
      {data?.expenses.map((e) => (
        <div key={e.id} className="flex items-center gap-3 border-[3px] border-line bg-panel p-3">
          <span className="min-w-0 flex-1">
            <span className="block font-black">{EXPENSE_LABELS[e.category][lang]}{e.note ? ` · ${e.note}` : ""}</span>
            <span className="block text-sm font-bold text-muted">{new Date(e.spentOn).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB")} · {t(e.method)}{e.createdByName ? ` · ${e.createdByName}` : ""}</span>
          </span>
          <span className="text-lg font-black">{formatTaka(e.amountPoisha, lang)}</span>
          <button className="min-h-11 border-2 border-line px-2 text-sm font-bold" onClick={() => void remove(e.id)}>{t("voidExpense")}</button>
        </div>
      ))}
    </section>
  );
}
