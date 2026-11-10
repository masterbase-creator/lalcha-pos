import { formatNumber, formatTaka, type CouponRecord, type GiftCardRecord, type Lang } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const primary = "min-h-13 bg-[#12130f] px-4 text-lg font-black text-accent ring-2 ring-line disabled:opacity-40";
const toPoisha = (s: string) => Math.round(Number(s || 0) * 100);
/** Easy to read out over the phone: no 0/O or 1/I. */
const newCode = (prefix: string) => `${prefix}${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;

async function errorOf(res: Response | null, t: T) {
  const body = (await res?.json().catch(() => null)) as { error?: string } | null;
  const code = body?.error as StringKey | undefined;
  return code && ["duplicate_code", "invalid_code_format", "bad_percent", "payment_ref_required"].includes(code) ? t(code) : t("saveFailed");
}

/** Coupons and gift cards. Points are earned and spent at the till, and adjusted from Baki. */
export function LoyaltyScreen({ lang, t, online, onChanged }: { lang: Lang; t: T; online: boolean; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<"coupons" | "giftCards">("coupons");
  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex gap-2">
          {(["coupons", "giftCards"] as const).map((x) => (
            <button key={x} aria-pressed={tab === x} onClick={() => setTab(x)} className={`min-h-12 flex-1 border-[3px] border-line text-lg font-black ${tab === x ? "bg-text text-bg" : "bg-panel"}`}>{t(x)}</button>
          ))}
        </div>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {tab === "coupons" ? <Coupons lang={lang} t={t} online={online} onChanged={onChanged} /> : <GiftCards lang={lang} t={t} online={online} />}
      </div>
    </main>
  );
}

function Coupons({ lang, t, online, onChanged }: { lang: Lang; t: T; online: boolean; onChanged: () => Promise<void> }) {
  const [list, setList] = useState<(CouponRecord & { discountGiven: number })[]>([]);
  const [editing, setEditing] = useState<CouponRecord | null>(null);
  const load = useCallback(async () => {
    const res = await apiFetch("/v1/coupons").catch(() => null);
    if (res?.ok) setList(((await res.json()) as { coupons: (CouponRecord & { discountGiven: number })[] }).coupons);
  }, []);
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  return (
    <section className="space-y-2">
      <button disabled={!online} className={`${primary} w-full`} onClick={() => setEditing({ id: uuidv7(), code: newCode(""), kind: "percent", value: 1000, minSpendPoisha: 0, maxDiscountPoisha: null, validUntil: null, maxUses: null, active: true })}>+ {t("addCoupon")}</button>
      {list.length === 0 && <p className="p-6 text-center font-bold text-muted">{t("noCoupons")}</p>}
      {list.map((c) => (
        <button key={c.id} disabled={!online} onClick={() => setEditing(c)} className="flex w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left">
          <span>
            <span className="block font-mono text-xl font-black">{c.code}</span>
            <span className="block text-sm font-bold text-muted">
              {c.kind === "percent" ? `${formatNumber(c.value / 100, lang)}%` : formatTaka(c.value, lang)} · {formatNumber(c.uses ?? 0, lang)} {t("used")} · {formatTaka(c.discountGiven, lang)} {t("discountGiven")}
            </span>
          </span>
          <span className={`font-black ${c.active ? "" : "text-hot"}`}>{c.active ? t("active") : t("inactive")}</span>
        </button>
      ))}
      {editing && <CouponForm coupon={editing} t={t} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await Promise.all([load(), onChanged()]); }} />}
    </section>
  );
}

function CouponForm({ coupon, t, onClose, onSaved }: { coupon: CouponRecord; t: T; onClose: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState(coupon.code);
  const [kind, setKind] = useState(coupon.kind);
  const [value, setValue] = useState(String(coupon.kind === "percent" ? coupon.value / 100 : coupon.value / 100));
  const [minSpend, setMinSpend] = useState(coupon.minSpendPoisha ? String(coupon.minSpendPoisha / 100) : "");
  const [maxDiscount, setMaxDiscount] = useState(coupon.maxDiscountPoisha ? String(coupon.maxDiscountPoisha / 100) : "");
  const [validUntil, setValidUntil] = useState(coupon.validUntil ?? "");
  const [maxUses, setMaxUses] = useState(coupon.maxUses ? String(coupon.maxUses) : "");
  const [active, setActive] = useState(coupon.active);
  const [error, setError] = useState("");

  async function save() {
    const body = {
      id: coupon.id, code: code.trim().toUpperCase(), kind, value: kind === "percent" ? Math.round(Number(value) * 100) : toPoisha(value),
      minSpendPoisha: toPoisha(minSpend), maxDiscountPoisha: maxDiscount ? toPoisha(maxDiscount) : null, validUntil: validUntil || null, maxUses: maxUses ? Number(maxUses) : null, active,
    };
    if (!(body.value > 0)) return setError(t("badNumber"));
    const res = await apiFetch("/v1/coupons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) return setError(await errorOf(res, t));
    await onSaved();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("addCoupon")}>
      <form className="max-h-full w-full max-w-md space-y-2 overflow-y-auto border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 className="text-2xl font-black">{t("coupon")}</h2>
        <label className="block font-bold">{t("coupon")}<input maxLength={32} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${field} font-mono`} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-bold">
            {t("couponKind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as "percent" | "fixed")} className={field}>
              <option value="percent">{t("percentOff")}</option>
              <option value="fixed">{t("amountOff")}</option>
            </select>
          </label>
          <label className="block font-bold">{t("couponValue")} ({kind === "percent" ? "%" : "৳"})<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
        </div>
        <label className="block font-bold">{t("minSpend")}<input inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={field} /></label>
        {kind === "percent" && <label className="block font-bold">{t("maxDiscount")}<input inputMode="decimal" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>}
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-bold">{t("validUntil")}<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={field} /></label>
          <label className="block font-bold">{t("maxUses")}<input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} className={field} /></label>
        </div>
        <label className="flex min-h-11 items-center gap-3 font-bold"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-6 w-6" />{t("active")}</label>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="min-h-13 flex-1 border-[3px] border-line font-black" onClick={onClose}>{t("cancel")}</button>
          <button className={`${primary} flex-[2]`}>{t("save")}</button>
        </div>
      </form>
    </div>
  );
}

function GiftCards({ lang, t, online }: { lang: Lang; t: T; online: boolean }) {
  const [list, setList] = useState<GiftCardRecord[]>([]);
  const [code, setCode] = useState(() => newCode("GC-"));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bkash" | "nagad" | "card">("cash");
  const [ref, setRef] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const res = await apiFetch("/v1/gift-cards").catch(() => null);
    if (res?.ok) setList(((await res.json()) as { giftCards: GiftCardRecord[] }).giftCards);
  }, []);
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  async function sell() {
    if (!(toPoisha(amount) > 0)) return setMessage(t("badNumber"));
    const res = await apiFetch("/v1/gift-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: uuidv7(), code, amountPoisha: toPoisha(amount), method, ref: ref.trim() || null, customerId: null, expiresOn: null }),
    }).catch(() => null);
    if (!res?.ok) return setMessage(await errorOf(res, t));
    setMessage(`${t("cardSold")}: ${code}`);
    setCode(newCode("GC-"));
    setAmount("");
    setRef("");
    await load();
  }

  async function disable(id: string) {
    await apiFetch(`/v1/gift-cards/${id}/disable`, { method: "POST" }).catch(() => null);
    await load();
  }

  return (
    <section className="space-y-3">
      <form className="space-y-2 border-[3px] border-line bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void sell(); }}>
        <h2 className="text-xl font-black">{t("sellGiftCard")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-bold">{t("giftCardCode")}<input maxLength={32} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${field} font-mono`} /></label>
          <label className="block font-bold">{t("cardAmount")}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={field} /></label>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {(["cash", "bkash", "nagad", "card"] as const).map((m) => (
            <button type="button" key={m} aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-12 border-[3px] border-line font-black ${method === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
          ))}
        </div>
        {(method === "bkash" || method === "nagad") && <label className="block font-bold">{t("ref")}<input maxLength={64} value={ref} onChange={(e) => setRef(e.target.value)} className={field} /></label>}
        {message && <p role="status" className="font-bold">{message}</p>}
        <button disabled={!online} className={`${primary} w-full`}>{t("sellGiftCard")}</button>
      </form>
      {list.length === 0 && <p className="p-6 text-center font-bold text-muted">{t("noGiftCards")}</p>}
      {list.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-3 border-[3px] border-line bg-panel p-3">
          <span>
            <span className="block font-mono text-lg font-black">{g.code}</span>
            <span className="block text-sm font-bold text-muted">{t("cardBalance")}: {formatTaka(g.balancePoisha, lang)} / {formatTaka(g.initialPoisha, lang)}</span>
          </span>
          {g.disabled ? <span className="font-black text-hot">{t("inactive")}</span> : <button disabled={!online} className="min-h-11 border-2 border-line px-3 font-bold" onClick={() => void disable(g.id)}>{t("disableCard")}</button>}
        </div>
      ))}
    </section>
  );
}
