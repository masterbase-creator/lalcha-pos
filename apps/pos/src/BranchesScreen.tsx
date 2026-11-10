import { formatQty, QTY_SCALE, type BranchRecord, type CatalogProduct, type Lang, type TransferRecord } from "@lalcha/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { name, ProductImage } from "./ProductImage";
import { apiFetch, type CurrentUser } from "./session";

type T = (k: StringKey) => string;
const field = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const ERRORS: StringKey[] = ["branch_limit", "insufficient_stock", "same_branch", "name_required", "no_lines", "not_open"];

async function send(path: string, method: string, body: unknown, t: T) {
  try {
    const res = await apiFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    const code = data?.error as StringKey | undefined;
    return code && ERRORS.includes(code) ? t(code) : t("saveFailed");
  } catch {
    return t("saveFailed");
  }
}

export function BranchesScreen({ products, user, lang, t, online, onChanged }: { products: CatalogProduct[]; user: CurrentUser; lang: Lang; t: T; online: boolean; onChanged: () => Promise<void> }) {
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const addId = useRef(uuidv7());

  const load = useCallback(async () => {
    try {
      const [b, tr] = await Promise.all([apiFetch("/v1/branches"), apiFetch("/v1/transfers?page=1")]);
      if (!b.ok || !tr.ok) throw new Error();
      const bd = (await b.json()) as { branches: BranchRecord[]; currentId: string };
      const td = (await tr.json()) as { transfers: TransferRecord[]; hasMore: boolean };
      setBranches(bd.branches);
      setCurrentId(bd.currentId);
      setTransfers(td.transfers);
      setHasMore(td.hasMore);
      setPage(1);
    } catch {
      setError(t("saveFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  async function more() {
    const res = await apiFetch(`/v1/transfers?page=${page + 1}`);
    if (!res.ok) return;
    const td = (await res.json()) as { transfers: TransferRecord[]; hasMore: boolean };
    setTransfers((x) => [...x, ...td.transfers]);
    setHasMore(td.hasMore);
    setPage(page + 1);
  }

  async function addBranch() {
    if (!newName.trim()) return;
    const failure = await send("/v1/branches", "POST", { id: addId.current, name: newName, address: null }, t);
    if (failure) return setError(failure);
    addId.current = uuidv7();
    setNewName("");
    setError("");
    await load();
  }

  async function finish(id: string, action: "receive" | "cancel") {
    const failure = await send(`/v1/transfers/${id}/${action}`, "POST", {}, t);
    if (failure) setError(failure);
    await Promise.all([load(), onChanged()]);
  }

  const statusKey = { sent: "transferSent", received: "statusReceived", cancelled: "statusCancelled" } as const;
  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <h1 className="text-2xl font-black">{t("branches")}</h1>
        <ul className="space-y-2">
          {branches.map((b) => (
            <li key={b.id} className="flex min-h-14 items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-lg font-black">
              <span>{b.name}</span>
              {b.id === currentId && <span className="text-sm text-muted">{t("thisDevice")}</span>}
            </li>
          ))}
        </ul>
        {user.role === "owner" && (
          <div className="flex gap-2">
            <input aria-label={t("branchName")} placeholder={t("branchName")} maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} className="h-13 min-w-0 flex-1 border-[3px] border-line bg-panel px-3 font-bold" />
            <button disabled={!online || !newName.trim()} className="min-h-13 shrink-0 bg-accent px-4 font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40" onClick={() => void addBranch()}>+ {t("addBranch")}</button>
          </div>
        )}
        <h2 className="pt-2 text-2xl font-black">{t("stockTransfers")}</h2>
        <button disabled={!online || branches.length < 2} className="min-h-13 w-full bg-accent font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40" onClick={() => setCreating(true)}>+ {t("newTransfer")}</button>
        {branches.length < 2 && <p className="font-bold text-muted">{t("needTwoBranches")}</p>}
        <ul className="space-y-2">
          {transfers.map((tr) => (
            <li key={tr.id} className="space-y-2 border-[3px] border-line bg-panel p-3">
              <div className="flex justify-between gap-2 font-black"><span>{tr.fromName} → {tr.toName}</span><span className={tr.status === "sent" ? "text-hot" : "text-muted"}>{t(statusKey[tr.status])}</span></div>
              <p className="font-bold text-muted">{tr.lines.map((l) => `${name(l, lang)} × ${formatQty(l.qty, l.unit, lang)}`).join(", ")}</p>
              {tr.status === "sent" && online && (
                <div className="flex gap-2">
                  <button className="min-h-12 flex-1 border-[3px] border-line font-black" onClick={() => void finish(tr.id, "cancel")}>{t("cancel")}</button>
                  <button className="min-h-12 flex-[2] bg-[#12130f] font-black text-accent ring-2 ring-line" onClick={() => void finish(tr.id, "receive")}>{t("receiveGoods")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {hasMore && <button className="min-h-12 w-full border-[3px] border-line font-black" onClick={() => void more()}>{t("loadMore")}</button>}
      </div>
      {creating && <NewTransfer branches={branches} currentId={currentId} products={products} lang={lang} t={t} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await Promise.all([load(), onChanged()]); }} />}
    </main>
  );
}

function NewTransfer({ branches, currentId, products, lang, t, onClose, onDone }: { branches: BranchRecord[]; currentId: string; products: CatalogProduct[]; lang: Lang; t: T; onClose: () => void; onDone: () => Promise<void> }) {
  const id = useRef(uuidv7());
  const [from, setFrom] = useState(currentId);
  const [to, setTo] = useState(branches.find((b) => b.id !== currentId)?.id ?? "");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<{ product: CatalogProduct; qty: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => [p.nameEn, p.nameBn, p.barcode ?? ""].some((v) => v.toLowerCase().includes(q))).slice(0, 6) : [];
  }, [products, query]);

  async function save() {
    if (busy) return;
    setBusy(true);
    const failure = await send("/v1/transfers", "POST", { id: id.current, fromBranchId: from, toBranchId: to, lines: lines.map((l) => ({ productId: l.product.id, qty: Math.round(Number(l.qty) * QTY_SCALE) })) }, t);
    setBusy(false);
    if (failure) setError(failure);
    else await onDone();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("newTransfer")}>
      <div className="max-h-full w-full max-w-xl space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4">
        <h2 className="text-2xl font-black">{t("newTransfer")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-bold">{t("fromBranch")}<select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block font-bold">{t("toBranch")}<select value={to} onChange={(e) => setTo(e.target.value)} className={field}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        </div>
        <div className="relative">
          <input aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="h-13 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold" />
          {matches.length > 0 && (
            <ul className="absolute inset-x-0 z-10 border-x-[3px] border-b-[3px] border-line bg-panel">
              {matches.map((p) => (
                <li key={p.id}>
                  <button className="flex min-h-14 w-full items-center gap-3 p-2 text-left font-bold" onClick={() => { setLines((c) => (c.some((l) => l.product.id === p.id) ? c : [{ product: p, qty: "1" }, ...c])); setQuery(""); }}>
                    <span className="relative h-11 w-11 shrink-0 bg-tile"><ProductImage product={p} lang={lang} /></span>
                    <span className="truncate">{name(p, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.product.id} className="flex items-center gap-2 font-bold">
              <span className="min-w-0 flex-1 truncate">{name(l.product, lang)}</span>
              <input aria-label={`${t("qty")}: ${name(l.product, lang)}`} inputMode="decimal" value={l.qty} onChange={(e) => { const qty = e.target.value.replace(/[^0-9.]/g, ""); setLines((c) => c.map((x) => (x === l ? { ...x, qty } : x))); }} className="h-12 w-24 border-[3px] border-line bg-bg px-2 text-right font-black" />
              <button aria-label={`${t("remove")}: ${name(l.product, lang)}`} className="h-12 w-12 border-2 border-line font-black" onClick={() => setLines((c) => c.filter((x) => x !== l))}>✕</button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>{t("cancel")}</button>
          <button disabled={busy || lines.length === 0} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40" onClick={() => void save()}>{t("sendTransfer")}</button>
        </div>
      </div>
    </div>
  );
}
