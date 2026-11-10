import type { Lang, SerialRecord } from "@lalcha/domain";
import { useEffect, useState } from "react";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

/** Look up a phone's IMEI or an item's serial: where it is, who bought it, and whether warranty still runs. */
export function WarrantyScreen({ lang, t, online }: { lang: Lang; t: (k: StringKey) => string; online: boolean }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<SerialRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3 || !online) return setList(null);
    const timer = window.setTimeout(async () => {
      const res = await apiFetch(`/v1/serials?q=${encodeURIComponent(query)}`).catch(() => null);
      if (!res?.ok) return setError(t("reportFailed"));
      setError("");
      setList(((await res.json()) as { serials: SerialRecord[] }).serials);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, online, t]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB");
  const status = { in_stock: t("statusInStock"), sold: t("statusSold"), returned: t("statusReturnedSerial") };

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-black">{t("warranty")}</h1>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchSerial")} aria-label={t("searchSerial")} className="h-13 w-full border-[3px] border-line bg-panel px-4 font-mono text-lg font-bold" />
        {!online && <p role="alert" className="font-bold text-hot">{t("reportsNeedOnline")}</p>}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        {q.trim().length > 0 && q.trim().length < 3 && <p className="font-bold text-muted">{t("typeThree")}</p>}
        {list?.length === 0 && <p className="p-8 text-center text-lg font-bold text-muted">{t("noSerialFound")}</p>}
        <ul className="space-y-2">
          {list?.map((s) => {
            const covered = s.warrantyUntil && Date.parse(s.warrantyUntil) > Date.now();
            return (
              <li key={s.id} className="space-y-1 border-[3px] border-line bg-panel p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-black">{lang === "bn" ? s.nameBn : s.nameEn}</span>
                  <span className="font-mono font-black">{s.serial}</span>
                </div>
                <p className="font-bold">
                  {status[s.status]}
                  {s.soldAt && ` · ${t("soldOn")} ${date(s.soldAt)}`}
                  {s.receiptNo && ` · #${s.receiptNo}`}
                  {s.customerName && ` · ${s.customerName}`}
                </p>
                {s.status === "sold" && (
                  <p className={`font-black ${covered ? "text-[#1f7a55]" : "text-hot"}`}>
                    {!s.warrantyMonths ? t("noWarranty") : covered ? `${t("underWarranty")} · ${date(s.warrantyUntil!)}` : `${t("warrantyOver")} · ${date(s.warrantyUntil!)}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
