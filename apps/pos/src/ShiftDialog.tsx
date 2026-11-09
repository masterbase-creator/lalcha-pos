import { formatTaka, type Lang } from "@lalcha/domain";
import { useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { StringKey } from "./i18n";
import { enqueueOp, expectedCash, loadShift, saveShift, type LocalShift } from "./local";
import { getAuth } from "./session";

const toPoisha = (v: string) => Math.round(Number(v || 0) * 100);

export function ShiftDialog({ lang, t, onClose }: { lang: Lang; t: (k: StringKey) => string; onClose: () => void }) {
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [expected, setExpected] = useState(0);
  const [amount, setAmount] = useState("");
  const [closed, setClosed] = useState<{ expected: number; counted: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (p: number) => formatTaka(p, lang);

  useEffect(() => {
    void loadShift().then(async (s) => {
      setShift(s);
      if (s) setExpected(await expectedCash(s));
    });
  }, []);

  async function open() {
    if (busy) return;
    setBusy(true);
    const s: LocalShift = { id: uuidv7(), openedAt: new Date().toISOString(), floatPoisha: toPoisha(amount) };
    await enqueueOp("shift_open", s.id, getAuth().user!.id, s);
    await saveShift(s);
    setBusy(false);
    onClose();
  }

  async function close() {
    if (busy || !shift) return;
    setBusy(true);
    const counted = toPoisha(amount);
    const exp = await expectedCash(shift);
    await enqueueOp("shift_close", uuidv7(), getAuth().user!.id, { id: shift.id, closedAt: new Date().toISOString(), expectedPoisha: exp, countedPoisha: counted });
    await saveShift(null);
    setClosed({ expected: exp, counted });
    setBusy(false);
  }

  const diff = closed ? closed.counted - closed.expected : 0;
  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("shift")}>
      <form className="w-full max-w-md space-y-3 border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); void (shift ? close() : open()); }}>
        <h2 className="text-2xl font-black">{closed ? t("shiftClosed") : shift ? t("closeShift") : t("openShift")}</h2>
        {closed ? (
          <>
            <div className="flex justify-between text-lg font-bold"><span>{t("expectedCash")}</span><span data-testid="shift-expected">{money(closed.expected)}</span></div>
            <div className="flex justify-between text-lg font-bold"><span>{t("countedCash")}</span><span>{money(closed.counted)}</span></div>
            <div className="flex items-end justify-between bg-accent p-3 text-on-accent"><span className="font-black">{t("difference")}</span><span data-testid="shift-diff" className="text-4xl font-black">{diff < 0 ? "−" : ""}{money(Math.abs(diff))}</span></div>
            <button type="button" className="min-h-14 w-full border-[3px] border-line text-lg font-black" onClick={onClose}>{t("close")}</button>
          </>
        ) : shift === undefined ? (
          <p className="font-bold text-muted">{t("loading")}</p>
        ) : (
          <>
            {shift && <div className="flex justify-between text-lg font-bold"><span>{t("expectedCash")}</span><span data-testid="shift-expected">{money(expected)}</span></div>}
            <label className="block font-bold">
              {shift ? t("countedCash") : t("openingCash")}
              <input autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-right text-3xl font-black" />
            </label>
            <div className="flex gap-2">
              <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>{t("cancel")}</button>
              <button type="submit" disabled={busy} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{shift ? t("closeShift") : t("openShift")}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
