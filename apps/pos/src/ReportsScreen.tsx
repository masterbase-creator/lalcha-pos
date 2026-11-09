import { formatNumber, formatQty, formatTaka, type Lang, type ReportResponse } from "@lalcha/domain";
import { useEffect, useMemo, useState } from "react";
import type { StringKey } from "./i18n";
import { ProductImage, name } from "./ProductImage";
import { buildLocalReport } from "./local";
import { apiFetch } from "./session";
import { download, workbook } from "./xlsx";

type T = (k: StringKey) => string;
type Preset = "today" | "week" | "month" | "custom";
type Bar = { label: string; netPoisha: number; bills: number };

/** Report days follow Bangladesh time, including on a device set to another timezone. */
const dhakaDate = (offsetDays = 0) => new Date(Date.now() + 6 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const inputClass = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";

function Stat({ label, value, tone, testid }: { label: string; value: string; tone?: "accent"; testid?: string }) {
  return (
    <div className={`border-[3px] border-line p-3 ${tone === "accent" ? "bg-accent text-on-accent" : "bg-panel"}`}>
      <p className="font-bold">{label}</p>
      <p data-testid={testid} className="text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function SalesChart({ bars, lang, t }: { bars: Bar[]; lang: Lang; t: T }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.netPoisha), 1);
  const shown = active === null ? null : bars[active];
  const gap = bars.length > 40 ? "gap-px" : "gap-0.5";

  return (
    <figure className="border-[3px] border-line bg-panel p-3">
      <figcaption className="flex min-h-14 items-start justify-between gap-3">
        <span className="text-xl font-black">{t("dailyNetSales")}</span>
        <span className="text-right" aria-live="polite">
          {shown ? (
            <>
              <span className="block font-black">{formatTaka(shown.netPoisha, lang)}</span>
              <span className="block text-sm font-bold text-muted">{shown.label} · {formatNumber(shown.bills, lang)} {t("bills")}</span>
            </>
          ) : (
            <span className="block text-sm font-bold text-muted">{t("peak")}: {formatTaka(max === 1 ? 0 : max, lang)}</span>
          )}
        </span>
      </figcaption>
      <div className="relative mt-2 h-44 border-b-2 border-line/40" onPointerLeave={() => setActive(null)}>
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-line/20" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-line/20" />
        <div className={`absolute inset-0 flex items-end ${gap}`}>
          {bars.map((b, i) => (
            <button
              key={b.label}
              type="button"
              aria-label={`${b.label}: ${formatTaka(b.netPoisha, lang)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
            >
              <span
                className="mx-auto block w-full max-w-10 rounded-t"
                style={{
                  height: `${b.netPoisha > 0 ? Math.max((b.netPoisha / max) * 100, 2) : 0}%`,
                  background: "var(--chart)",
                  opacity: active === null || active === i ? 1 : 0.45,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-sm font-bold text-muted">
        <span>{bars[0]?.label}</span>
        {bars.length > 1 && <span>{bars[bars.length - 1]?.label}</span>}
      </div>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 font-bold underline">{t("viewAsTable")}</summary>
        <table className="w-full text-left font-bold">
          <thead>
            <tr><th className="py-1">{t("date")}</th><th className="py-1 text-right">{t("bills")}</th><th className="py-1 text-right">{t("netSales")}</th></tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.label} className="border-t border-line/20">
                <td className="py-1">{b.label}</td>
                <td className="py-1 text-right">{formatNumber(b.bills, lang)}</td>
                <td className="py-1 text-right">{formatTaka(b.netPoisha, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const sectionClass = "border-[3px] border-line bg-panel p-3";
const rowClass = "flex items-center justify-between gap-3 border-t-2 border-line/20 py-2 font-bold first:border-t-0";

export function ReportsScreen({ lang, t, online }: { lang: Lang; t: T; online: boolean }) {
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState(() => dhakaDate(-6));
  const [to, setTo] = useState(() => dhakaDate());
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const range = useMemo(() => {
    if (preset === "today") return { from: dhakaDate(), to: dhakaDate() };
    if (preset === "week") return { from: dhakaDate(-6), to: dhakaDate() };
    if (preset === "month") return { from: `${dhakaDate().slice(0, 7)}-01`, to: dhakaDate() };
    return { from, to };
  }, [preset, from, to]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let body: ReportResponse;
      try {
        // A signed-out offline session can't use the server, so any failure falls back to the device.
        const r = await apiFetch(`/v1/reports?from=${range.from}&to=${range.to}`);
        if (!r.ok) throw new Error();
        body = (await r.json()) as ReportResponse;
      } catch {
        try {
          body = await buildLocalReport(range.from, range.to);
        } catch {
          if (!cancelled) setFailed(true);
          return;
        }
      }
      if (!cancelled) {
        setReport(body);
        setFailed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, online]);

  const money = (p: number) => formatTaka(p, lang);
  const dayLabel = (d: string) => new Date(`${d}T12:00:00+06:00`).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short" });
  const bars = useMemo((): Bar[] => {
    if (!report) return [];
    // A year of daily bars would be unreadable, so long ranges group into weeks.
    if (report.daily.length <= 62) return report.daily.map((d) => ({ label: dayLabel(d.date), netPoisha: d.netPoisha, bills: d.bills }));
    const weeks: Bar[] = [];
    for (let i = 0; i < report.daily.length; i += 7) {
      const part = report.daily.slice(i, i + 7);
      weeks.push({
        label: dayLabel(part[0].date),
        netPoisha: part.reduce((s, d) => s + d.netPoisha, 0),
        bills: part.reduce((s, d) => s + d.bills, 0),
      });
    }
    return weeks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, lang]);

  const margin = report && report.netSalesPoisha > 0 ? Math.round((report.grossProfitPoisha / report.netSalesPoisha) * 100) : 0;
  const averageBill = report && report.bills > 0 ? Math.round(report.netSalesPoisha / report.bills) : 0;
  const taka = (p: number) => Math.round(p) / 100;
  const summaryRows = (r: ReportResponse): [string, number | string][] => [
    [t("netSales"), taka(r.netSalesPoisha)],
    ...(r.partial ? [] : ([[t("grossProfit"), taka(r.grossProfitPoisha)]] as [string, number][])),
    [t("bills"), r.bills],
    [t("returns"), taka(r.returnsPoisha)],
    [t("discount"), taka(r.discountPoisha)],
    [t("vatCollected"), taka(r.vatPoisha)],
    [t("bakiGiven"), taka(r.bakiGivenPoisha)],
    ...r.payments.map((p): [string, number] => [t(p.method), taka(p.receivedPoisha - p.refundedPoisha)]),
  ];
  function exportExcel() {
    if (!report) return;
    const blob = workbook([
      { name: "Summary", rows: [[`${range.from} – ${range.to}`], ...summaryRows(report)] },
      { name: "Daily", rows: [[t("date"), t("bills"), t("netSales")], ...report.daily.map((d) => [d.date, d.bills, taka(d.netPoisha)])] },
      { name: "Products", rows: [[t("topProducts"), t("qty"), t("netSales")], ...report.topProducts.map((p) => [name(p, lang), p.qty / 1000, taka(p.salesPoisha)])] },
      { name: "Staff", rows: [[t("staff"), t("bills"), t("netSales")], ...report.cashiers.map((c) => [c.name, c.bills, taka(c.salesPoisha)])] },
    ]);
    download(blob, `report-${range.from}-${range.to}.xlsx`);
  }
  function exportPdf() {
    if (!report) return;
    const cell = (v: string | number) => `<td>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`;
    const table = (rows: (string | number)[][]) => `<table>${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</table>`;
    const frame = document.createElement("iframe");
    frame.setAttribute("style", "position:fixed;width:0;height:0;border:0");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${range.from} – ${range.to}</title><style>body{font-family:"Hind Siliguri","Noto Sans Bengali",Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin:0 0 20px}td{border:1px solid #999;padding:4px 8px}h1,h2{margin:0 0 8px}</style></head><body><h1>${t("reports")}: ${range.from} – ${range.to}</h1>${table(summaryRows(report))}<h2>${t("dailyNetSales")}</h2>${table(report.daily.map((d) => [d.date, d.bills, taka(d.netPoisha)]))}<h2>${t("topProducts")}</h2>${table(report.topProducts.map((p) => [name(p, lang), formatQty(p.qty, p.unit, lang), taka(p.salesPoisha)]))}<h2>${t("byStaff")}</h2>${table(report.cashiers.map((c) => [c.name, c.bills, taka(c.salesPoisha)]))}</body></html>`);
    doc.close();
    window.setTimeout(() => {
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 60_000);
    }, 200);
  }

  const presets: [Preset, StringKey][] = [["today", "today"], ["week", "last7"], ["month", "thisMonth"], ["custom", "customRange"]];

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="grid grid-cols-4 border-[3px] border-line text-sm font-black sm:text-base">
          {presets.map(([p, label]) => (
            <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)} className={`min-h-12 ${preset === p ? "bg-text text-bg" : "bg-panel"}`}>{t(label)}</button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block font-bold">{t("fromDate")}<input type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></label>
            <label className="block font-bold">{t("toDate")}<input type="date" min={from} max={dhakaDate()} value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></label>
          </div>
        )}
        {report?.partial && <p role="status" className="font-bold text-hot">{t("offlineReport")}</p>}
        {failed && <p role="alert" className="font-bold text-hot">{t("reportFailed")}</p>}

        {report && (
          <>
            <div className="flex gap-2">
              <button data-testid="export-excel" className="min-h-12 flex-1 border-[3px] border-line bg-panel font-black" onClick={exportExcel}>Excel</button>
              <button data-testid="export-pdf" className="min-h-12 flex-1 border-[3px] border-line bg-panel font-black" onClick={exportPdf}>PDF</button>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label={t("netSales")} value={money(report.netSalesPoisha)} tone="accent" testid="net-sales" />
              {!report.partial && <Stat label={`${t("grossProfit")} · ${formatNumber(margin, lang)}%`} value={money(report.grossProfitPoisha)} testid="gross-profit" />}
              <Stat label={t("bills")} value={formatNumber(report.bills, lang)} testid="bills" />
              <Stat label={t("averageBill")} value={money(averageBill)} />
              <Stat label={t("returns")} value={money(report.returnsPoisha)} />
              <Stat label={t("discount")} value={money(report.discountPoisha)} />
              <Stat label={t("bakiGiven")} value={money(report.bakiGivenPoisha)} />
              {!report.partial && <Stat label={t("bakiCollected")} value={money(report.bakiCollectedPoisha)} />}
            </div>

            <SalesChart bars={bars} lang={lang} t={t} />

            <div className="grid gap-3 md:grid-cols-2">
              <section className={sectionClass}>
                <h2 className="mb-1 text-xl font-black">{t("moneyIn")}</h2>
                {report.payments.map((p) => (
                  <div key={p.method} className={rowClass}>
                    <span>{t(p.method)}</span>
                    <span className="text-right font-black">{money(p.receivedPoisha)}{p.refundedPoisha > 0 && <span className="block text-sm font-bold text-hot">−{money(p.refundedPoisha)}</span>}</span>
                  </div>
                ))}
                {!report.partial && <div className={`${rowClass} text-lg`}><span>{t("cashMovement")}</span><span data-testid="cash-movement" className="font-black">{money(report.cashMovementPoisha)}</span></div>}
              </section>
              <section className={sectionClass}>
                <h2 className="mb-1 text-xl font-black">{t("rightNow")}</h2>
                <div className={rowClass}><span>{t("vatCollected")}</span><span className="font-black">{money(report.vatPoisha)}</span></div>
                {!report.partial && <div className={rowClass}><span>{t("stockValue")}</span><span className="font-black">{money(report.stockValuePoisha)}</span></div>}
                <div className={rowClass}><span>{t("bakiOutstanding")}</span><span className="font-black">{money(report.bakiOutstandingPoisha)}</span></div>
                {!report.partial && <div className={rowClass}><span>{t("totalDue")}</span><span className="font-black">{money(report.supplierOwedPoisha)}</span></div>}
              </section>
              <section className={sectionClass}>
                <h2 className="mb-1 text-xl font-black">{t("topProducts")}</h2>
                {report.topProducts.length === 0 && <p className="py-2 font-bold text-muted">{t("noSales")}</p>}
                {report.topProducts.map((p) => (
                  <div key={p.id} className={rowClass}>
                    <span className="relative h-11 w-11 shrink-0 bg-tile"><ProductImage product={{ ...p, sku: "", barcode: null, category: "", pricePoisha: 0, stock: 0 }} lang={lang} /></span>
                    <span className="min-w-0 flex-1 truncate">{name(p, lang)}<span className="block text-sm text-muted">{formatQty(p.qty, p.unit, lang)} {t("sold")}</span></span>
                    <span className="font-black">{money(p.salesPoisha)}</span>
                  </div>
                ))}
              </section>
              <section className={sectionClass}>
                <h2 className="mb-1 text-xl font-black">{t("byStaff")}</h2>
                {report.cashiers.length === 0 && <p className="py-2 font-bold text-muted">{t("noSales")}</p>}
                {report.cashiers.map((c) => (
                  <div key={c.name} className={rowClass}>
                    <span className="min-w-0 truncate">{c.name}<span className="block text-sm text-muted">{formatNumber(c.bills, lang)} {t("bills")}</span></span>
                    <span className="font-black">{money(c.salesPoisha)}</span>
                  </div>
                ))}
                {report.shifts && report.shifts.length > 0 && (
                  <>
                    <h2 className="mt-4 mb-1 text-xl font-black">{t("shift")}</h2>
                    {report.shifts.map((s) => (
                      <div key={s.id} className={rowClass}>
                        <span className="min-w-0 truncate">{s.openedBy ?? "—"}<span className="block text-sm text-muted">{new Date(s.openedAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")}</span></span>
                        <span className="text-right font-black">{s.countedPoisha === null ? t("shiftOpenNow") : `${s.countedPoisha - (s.expectedPoisha ?? 0) < 0 ? "−" : ""}${money(Math.abs(s.countedPoisha - (s.expectedPoisha ?? 0)))}`}</span>
                      </div>
                    ))}
                  </>
                )}
                <h2 className="mt-4 mb-1 text-xl font-black">{t("lowStock")}</h2>
                {report.lowStock.length === 0 && <p className="py-2 font-bold text-muted">{t("noLowStock")}</p>}
                {report.lowStock.map((p) => (
                  <div key={p.id} className={rowClass}>
                    <span className="relative h-11 w-11 shrink-0 bg-tile"><ProductImage product={{ ...p, sku: "", barcode: null, category: "", pricePoisha: 0 }} lang={lang} /></span>
                    <span className="min-w-0 flex-1 truncate">{name(p, lang)}</span>
                    <span className="font-black text-hot">{formatQty(p.stock, p.unit, lang)}</span>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
