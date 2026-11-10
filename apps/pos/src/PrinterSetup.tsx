import { useEffect, useState } from "react";
import { connectPrinter, directPrintSupported, openDrawer, printDirect, printerReady, reconnectPrinter } from "./escpos";
import type { StringKey } from "./i18n";

export type Printing = { receiptPrinter: "browser" | "direct"; paperWidth: 58 | 80; cashDrawer: boolean; kitchenTickets: boolean };

/** How receipts print, used in onboarding and in Settings. Connecting is per device, so it's done here too. */
export function PrinterSetup({ value, restaurant, t, onChange }: { value: Printing; restaurant: boolean; t: (k: StringKey) => string; onChange: (v: Printing) => void }) {
  const [connected, setConnected] = useState(printerReady());
  const [message, setMessage] = useState("");
  const supported = directPrintSupported();

  useEffect(() => {
    if (value.receiptPrinter === "direct") void reconnectPrinter().then(setConnected);
  }, [value.receiptPrinter]);

  async function connect(kind: "usb" | "serial") {
    setMessage("");
    try {
      await connectPrinter(kind);
      setConnected(true);
      setMessage(t("printerConnected"));
    } catch {
      setMessage(t("printerFailed"));
    }
  }

  async function test() {
    setMessage("");
    try {
      await printDirect([{ kind: "text", text: "Lalcha POS", align: "center", bold: true, size: "large" }, { kind: "text", text: "টেস্ট প্রিন্ট · Test print", align: "center" }, { kind: "rule" }, { kind: "pair", left: "চা · Tea", right: "৳১৫" }], value.paperWidth);
    } catch {
      setMessage(t("printerFailed"));
    }
  }

  const option = (mode: Printing["receiptPrinter"], title: StringKey, help: StringKey, disabled = false) => (
    <label className={`flex min-h-16 items-start gap-3 border-[3px] p-3 ${value.receiptPrinter === mode ? "border-hot bg-panel" : "border-line bg-panel"} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="radio" name="printer" disabled={disabled} className="mt-1 h-6 w-6 shrink-0" checked={value.receiptPrinter === mode} onChange={() => onChange({ ...value, receiptPrinter: mode })} />
      <span>
        <span className="block text-lg font-black">{t(title)}</span>
        <span className="block text-sm font-bold text-muted">{disabled ? t("printerUnsupported") : t(help)}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-2">
      {option("browser", "printBrowser", "printBrowserHelp")}
      {option("direct", "printDirect", "printDirectHelp", !supported)}
      <label className="block font-bold">
        {t("paperWidth")}
        <select value={value.paperWidth} onChange={(e) => onChange({ ...value, paperWidth: Number(e.target.value) as 58 | 80 })} className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold">
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </select>
      </label>
      {value.receiptPrinter === "direct" && (
        <div className="space-y-2 border-[3px] border-line p-3">
          <p className="font-bold">{connected ? `✓ ${t("printerConnected")}` : t("printerNotConnected")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-12 border-[3px] border-line font-black" onClick={() => void connect("usb")}>{t("connectPrinter")} (USB)</button>
            <button type="button" className="min-h-12 border-[3px] border-line font-black" onClick={() => void connect("serial")}>{t("connectPrinter")} (COM)</button>
            <button type="button" disabled={!connected} className="min-h-12 border-[3px] border-line font-black disabled:opacity-40" onClick={() => void test()}>{t("testPrint")}</button>
            <button type="button" disabled={!connected} className="min-h-12 border-[3px] border-line font-black disabled:opacity-40" onClick={() => void openDrawer().catch(() => setMessage(t("printerFailed")))}>{t("openDrawer")}</button>
          </div>
          <label className="flex min-h-11 items-start gap-3 font-bold">
            <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={value.cashDrawer} onChange={(e) => onChange({ ...value, cashDrawer: e.target.checked })} />
            <span>{t("cashDrawerOpt")}<span className="block text-sm text-muted">{t("cashDrawerHelp")}</span></span>
          </label>
        </div>
      )}
      {restaurant && (
        <label className="flex min-h-11 items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6" checked={value.kitchenTickets} onChange={(e) => onChange({ ...value, kitchenTickets: e.target.checked })} />
          {t("kitchenTicketsOpt")}
        </label>
      )}
      {message && <p role="status" className="font-bold">{message}</p>}
    </div>
  );
}
