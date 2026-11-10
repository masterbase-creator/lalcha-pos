import { formatNumber, formatQty, type BatchRecord, type Lang } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

const DAY = 86_400_000;

/** Batches running out of date, soonest first, with a way to take expired stock off the shelf. */
export function ExpiryScreen({ lang, t, online, alertDays, onChanged }: { lang: Lang; t: (k: StringKey) => string; online: boolean; alertDays: number; onChanged: () => Promise<void> }) {
  const [days, setDays] = useState(alertDays);
  const [list, setList] = useState<BatchRecord[] | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const res = await apiFetch(`/v1/batches?days=${days}`).catch(() => null);
    if (!res?.ok) return setError(t("reportFailed"));
    const body = (await res.json()) as { batches: BatchRecord[]; today: string };
    setList(body.batches);
    setToday(body.today);
  }, [days, t]);
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  async function writeOff(b: BatchRecord) {
    if (confirming !== b.id) return setConfirming(b.id);
    setConfirming(null);
    const res = await apiFetch(`/v1/batches/${b.id}/write-off`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: uuidv7(), qty: b.qty }) }).catch(() => null);
    if (!res?.ok) return setError(t("saveFailed"));
    await Promise.all([load(), onChanged()]);
  }

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-2xl font-black">{t("expiry")}</h1>
          <span className="font-bold">{t("expiringWithin")}</span>
          {[30, 60, 90, 180].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)} className={`min-h-11 border-2 border-line px-3 font-black ${days === d ? "bg-text text-bg" : "bg-panel"}`}>{formatNumber(d, lang)}</button>
          ))}
          <span className="font-bold">{t("days")}</span>
        </div>
        {!online && <p role="alert" className="font-bold text-hot">{t("reportsNeedOnline")}</p>}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        {list?.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noExpiring")}</p>}
        <ul className="space-y-2">
          {list?.map((b) => {
            const left = b.expiresOn && today ? Math.round((Date.parse(b.expiresOn) - Date.parse(today)) / DAY) : null;
            const expired = left !== null && left < 0;
            return (
              <li key={b.id} className={`flex flex-wrap items-center gap-3 border-[3px] bg-panel p-3 ${expired ? "border-hot" : "border-line"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-black">{lang === "bn" ? b.nameBn : b.nameEn}</span>
                  <span className="block text-sm font-bold text-muted">{t("batchNo")}: {b.batchNo} · {b.branchName} · {formatQty(b.qty, b.unit, lang)}</span>
                </span>
                <span className={`text-right font-black ${expired || (left ?? 99) <= 7 ? "text-hot" : ""}`}>
                  {b.expiresOn && new Date(b.expiresOn).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB")}
                  <span className="block text-sm">{left === null ? "" : expired ? `${formatNumber(-left, lang)} ${t("expiredAgo")}` : `${formatNumber(left, lang)} ${t("daysLeft")}`}</span>
                </span>
                <button disabled={!online} title={t("writeOffHelp")} className="min-h-12 border-[3px] border-line px-3 font-black disabled:opacity-40" onClick={() => void writeOff(b)}>
                  {confirming === b.id ? t("archiveConfirm") : t("writeOff")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
