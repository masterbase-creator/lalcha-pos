import { formatTaka, SUPPLIER_PAYMENT_METHODS, type CustomerDetail, type CustomerSummary, type Lang, type SupplierPaymentMethod } from "@lalcha/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { addLocalCustomer, enqueueOp } from "./local";
import { apiFetch, getAuth } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const API_ERRORS: StringKey[] = ["name_required", "invalid_phone", "duplicate_phone", "exceeds_due", "payment_ref_required", "customer_has_due"];
const money = (text: string) => (text.trim() === "" ? 0 : Math.round(Number(text) * 100));

async function errorText(res: Response, t: T) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const code = body?.error as StringKey | undefined;
  return code && API_ERRORS.includes(code) ? t(code) : t("saveFailed");
}

export function BakiScreen({
  customers, lang, t, online, canManage, onChanged,
}: { customers: CustomerSummary[]; lang: Lang; t: T; online: boolean; canManage: boolean; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<{ customer: CustomerSummary | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [onlyDue, setOnlyDue] = useState(true);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => (!onlyDue || c.duePoisha > 0) && (!q || c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q)))
      .sort((a, b) => b.duePoisha - a.duePoisha);
  }, [customers, query, onlyDue]);
  const total = customers.reduce((sum, c) => sum + Math.max(c.duePoisha, 0), 0);

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
          <span className="text-lg font-black">{t("bakiOutstanding")}</span>
          <span data-testid="baki-total" className="text-4xl font-black">{formatTaka(total, lang)}</span>
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchCustomer")} aria-label={t("searchCustomer")} className="h-13 min-w-0 flex-1 border-[3px] border-line bg-panel px-3 text-lg font-bold" />
          <button onClick={() => setForm({ customer: null })} className="min-h-13 shrink-0 bg-accent px-4 text-lg font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40">+ {t("addCustomer")}</button>
        </div>
        <label className="flex min-h-11 items-center gap-3 font-bold">
          <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} className="h-6 w-6" />
          {t("onlyWithBaki")}
        </label>
        {visible.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noCustomers")}</p>}
        <ul className="space-y-2">
          {visible.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpen(c.id)} className="flex min-h-16 w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-black">{c.name}</span>
                  <span className="block font-bold text-muted">{c.phone ?? "—"}</span>
                </span>
                <span className={`shrink-0 text-xl font-black ${c.duePoisha > 0 ? "text-hot" : ""}`}>{formatTaka(c.duePoisha, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {form && <CustomerForm customer={form.customer} t={t} online={online} canRemove={canManage} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await onChanged(); }} />}
      {open && (
        <CustomerView id={open} summary={customers.find((c) => c.id === open) ?? null} online={online} lang={lang} t={t} onClose={() => setOpen(null)} onChanged={onChanged}
          onEdit={(c) => { setOpen(null); setForm({ customer: c }); }} />
      )}
    </main>
  );
}

function CustomerForm({ customer, t, online, canRemove, onClose, onSaved }: { customer: CustomerSummary | null; t: T; online: boolean; canRemove: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const id = useRef(customer?.id ?? uuidv7());
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [limit, setLimit] = useState(customer?.creditLimitPoisha != null ? String(customer.creditLimitPoisha / 100) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const creditLimitPoisha = limit.trim() === "" ? null : Math.round(Number(limit) * 100);

  async function remove() {
    if (!customer || busy) return;
    if (!confirmRemove) return setConfirmRemove(true);
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/customers/${customer.id}`, { method: "DELETE" });
      if (!res.ok) setError(await errorText(res, t));
      else await onSaved();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!customer) {
        if (phone && !/^01[3-9]\d{8}$/.test(phone)) {
          setError(t("invalid_phone"));
          return;
        }
        await addLocalCustomer({ id: id.current, name: name.trim(), phone: phone || null, address: address.trim() || null, duePoisha: 0, creditLimitPoisha }, getAuth().user!.id);
        await onSaved();
        return;
      }
      const res = await apiFetch(customer ? `/v1/customers/${customer.id}` : "/v1/customers", {
        method: customer ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: id.current, name, phone: phone || null, address: address.trim() || null, creditLimitPoisha }),
      });
      if (!res.ok) setError(await errorText(res, t));
      else await onSaved();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={customer ? t("editCustomer") : t("addCustomer")}>
      <form className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 className="text-2xl font-black">{customer ? t("editCustomer") : t("addCustomer")}</h2>
        <label className="block font-bold">{t("customerName")}<input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
        <label className="block font-bold">{t("phone")}<input inputMode="tel" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="01XXXXXXXXX" className={field} /></label>
        <label className="block font-bold">{t("address")}<input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={field} /></label>
        <label className="block font-bold">{t("creditLimit")}<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={t("noLimit")} className={field} /></label>
        {customer && !online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" disabled={busy || (Boolean(customer) && !online)} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{busy ? t("saving") : t("save")}</button>
        </div>
        {customer && canRemove && online && (
          <button type="button" className="min-h-11 w-full font-bold text-hot underline" onClick={() => void remove()}>{confirmRemove ? t("archiveConfirm") : t("removeCustomer")}</button>
        )}
      </form>
    </div>
  );
}

function CustomerView({
  id, summary, online, lang, t, onClose, onEdit, onChanged,
}: { id: string; summary: CustomerSummary | null; online: boolean; lang: Lang; t: T; onClose: () => void; onEdit: (c: CustomerSummary) => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<SupplierPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentId = useRef(uuidv7());
  const when = (iso: string) => new Date(iso).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB");

  const load = useCallback(async () => {
    const r = await apiFetch(`/v1/customers/${id}`);
    if (!r.ok) throw new Error();
    setDetail((await r.json()) as CustomerDetail);
  }, [id]);

  useEffect(() => {
    // The history needs the server. Offline, the device's own balance is shown without it.
    if (online) load().catch(() => undefined);
  }, [load, online]);

  async function collect() {
    if (busy || money(amount) <= 0) return;
    setBusy(true);
    setError("");
    try {
      if (money(amount) > (summary?.duePoisha ?? 0)) {
        setError(t("exceeds_due"));
        return;
      }
      if ((method === "bkash" || method === "nagad") && !reference.trim()) {
        setError(t("payment_ref_required"));
        return;
      }
      await enqueueOp("customer_payment", paymentId.current, getAuth().user!.id, { id: paymentId.current, customerId: id, amountPoisha: money(amount), method, ref: reference.trim() || null });
      paymentId.current = uuidv7();
      setAmount("");
      setReference("");
      await onChanged();
      if (online) await load().catch(() => undefined);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  // The device figure includes collections and sales still waiting to upload.
  const customer = summary ?? detail?.customer;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={customer?.name ?? t("loading")}>
      <div className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4">
        <h2 className="text-2xl font-black">{customer?.name ?? t("loading")}</h2>
        {customer && (
          <>
            <p className="font-bold text-muted">{[customer.phone, customer.address].filter(Boolean).join(" · ") || "—"}</p>
            <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
              <span className="text-lg font-black">{t("due")}</span>
              <span data-testid="customer-due" className="text-4xl font-black">{formatTaka(customer.duePoisha, lang)}</span>
            </div>
            {customer.duePoisha > 0 && (
              <div className="space-y-2">
                <label className="block font-bold">
                  {t("collectAmount")}
                  <div className="flex gap-2">
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={field} />
                    <button type="button" className="mt-1 h-12 shrink-0 border-[3px] border-line px-3 font-black" onClick={() => setAmount(String(customer.duePoisha / 100))}>
                      {t("payFull")} {formatTaka(customer.duePoisha, lang)}
                    </button>
                  </div>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {SUPPLIER_PAYMENT_METHODS.map((m) => (
                    <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line font-black ${method === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
                  ))}
                </div>
                {method !== "cash" && (
                  <label className="block font-bold">{t("ref")}<input maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} className={field} /></label>
                )}
                <button disabled={busy || money(amount) <= 0} onClick={() => void collect()} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("collectBaki")}</button>
              </div>
            )}
            {detail && detail.sales.length > 0 && (
              <>
                <h3 className="text-lg font-black">{t("bakiSales")}</h3>
                <ul>
                  {detail.sales.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2 border-b-2 border-line/20 py-2 font-bold">
                      <span>{when(s.soldAt)} · #{s.receiptNo}</span>
                      <span className="font-black">{formatTaka(s.totalPoisha - s.paidPoisha, lang)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {detail && detail.payments.length > 0 && (
              <>
                <h3 className="text-lg font-black">{t("paymentHistory")}</h3>
                <ul>
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 border-b-2 border-line/20 py-2 font-bold">
                      <span>{when(p.paidAt)} · {t(p.method as StringKey)}{p.ref ? ` · ${p.ref}` : ""}</span>
                      <span className="font-black">{formatTaka(p.amountPoisha, lang)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>{t("close")}</button>
          {customer && <button className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={() => onEdit(customer)}>{t("editCustomer")}</button>}
        </div>
      </div>
    </div>
  );
}
