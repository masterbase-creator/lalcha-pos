import { CATEGORIES, productCreateSchema, QTY_SCALE, UNITS, type Lang } from "@lalcha/domain";
import { useState } from "react";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";
import { download, readCsv, readFirstSheet, workbook } from "./xlsx";

const HEADERS = ["name_bn", "name_en", "category", "unit", "selling_price", "cost_price", "barcode", "opening_stock", "vat_percent"];
type Parsed = { line: number; row?: unknown; error?: string };

function parseRows(table: string[][]): Parsed[] {
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = (cells: string[], name: string) => (cells[head.indexOf(name)] ?? "").trim();
  return table.slice(1).map((cells, i) => {
    const unitText = at(cells, "unit").toLowerCase() || "pc";
    const vatText = at(cells, "vat_percent");
    const candidate = {
      nameBn: at(cells, "name_bn"),
      nameEn: at(cells, "name_en"),
      category: CATEGORIES.includes(at(cells, "category") as (typeof CATEGORIES)[number]) ? at(cells, "category") : CATEGORIES[0],
      unit: UNITS.includes(unitText as (typeof UNITS)[number]) ? unitText : "invalid",
      pricePoisha: Math.round(Number(at(cells, "selling_price")) * 100),
      costPoisha: Math.round(Number(at(cells, "cost_price") || 0) * 100),
      barcode: at(cells, "barcode") || null,
      openingStock: Math.round(Number(at(cells, "opening_stock") || 0) * QTY_SCALE),
      vatRateBp: vatText === "" ? null : Math.round(Number(vatText) * 100),
    };
    const checked = productCreateSchema.safeParse(candidate);
    return checked.success ? { line: i + 2, row: checked.data } : { line: i + 2, error: checked.error.issues[0]?.path.join(".") || checked.error.issues[0]?.message };
  });
}

export function ImportDialog({ t, onClose, onDone }: { lang: Lang; t: (k: StringKey) => string; onClose: () => void; onDone: () => Promise<void> }) {
  const [parsed, setParsed] = useState<Parsed[] | null>(null);
  const [result, setResult] = useState<{ created: number; rejected: { line: number; reason: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function template() {
    download(
      workbook([{ name: "Products", rows: [HEADERS, ["মিনিকেট চাল", "Miniket Rice", "staples", "kg", 82, 74, "", 50, ""], ["কোলা ক্যান", "Cola Can", "drinks", "pc", 50, 42, "8941234567890", 24, 15]] }]),
      "lalcha-products-template.xlsx",
    );
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setResult(null);
    try {
      const table = /\.csv$/i.test(file.name) ? readCsv(await file.text()) : await readFirstSheet(file);
      if (table.length < 2) throw new Error();
      setParsed(parseRows(table));
    } catch {
      setError(t("importBadFile"));
    }
  }

  async function run() {
    if (!parsed || busy) return;
    setBusy(true);
    setError("");
    const valid = parsed.filter((p) => p.row);
    const rejected = parsed.filter((p) => p.error).map((p) => ({ line: p.line, reason: p.error! }));
    let created = 0;
    try {
      for (let i = 0; i < valid.length; i += 500) {
        const batch = valid.slice(i, i + 500);
        const res = await apiFetch("/v1/products/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: batch.map((b) => b.row) }) });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { results: { index: number; status: string; reason?: string }[] };
        for (const r of body.results) {
          if (r.status === "created") created++;
          else rejected.push({ line: batch[r.index].line, reason: r.reason ?? "invalid" });
        }
      }
      setResult({ created, rejected });
      setParsed(null);
      await onDone();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const good = parsed?.filter((p) => p.row).length ?? 0;
  const bad = parsed?.filter((p) => p.error) ?? [];
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("importProducts")}>
      <div className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4">
        <h2 className="text-2xl font-black">{t("importProducts")}</h2>
        <p className="font-bold text-muted">{t("importHelp")}</p>
        <button data-testid="import-template" className="min-h-12 w-full border-[3px] border-line font-black" onClick={template}>{t("downloadTemplate")}</button>
        <label className="flex min-h-14 cursor-pointer items-center justify-center border-[3px] border-dashed border-line font-black">
          {t("chooseFile")}
          <input data-testid="import-file" type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {parsed && (
          <>
            <p data-testid="import-preview" className="text-lg font-black">{good} {t("importReady")} · {bad.length} {t("importProblems")}</p>
            {bad.slice(0, 20).map((p) => <p key={p.line} className="font-bold text-hot">#{p.line}: {p.error}</p>)}
            <button data-testid="import-run" disabled={busy || good === 0} className="min-h-14 w-full bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40" onClick={() => void run()}>{busy ? t("saving") : t("importNow")}</button>
          </>
        )}
        {result && (
          <>
            <p data-testid="import-result" className="text-lg font-black">{result.created} {t("importCreated")} · {result.rejected.length} {t("importProblems")}</p>
            {result.rejected.slice(0, 30).map((r) => <p key={r.line} className="font-bold text-hot">#{r.line}: {r.reason}</p>)}
          </>
        )}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <button className="min-h-14 w-full border-[3px] border-line text-lg font-black" onClick={onClose}>{t("close")}</button>
      </div>
    </div>
  );
}
