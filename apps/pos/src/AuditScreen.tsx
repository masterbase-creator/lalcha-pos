import type { AuditEntry, Lang } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import type { StringKey } from "./i18n";
import { apiFetch } from "./session";

const LABELS: Record<string, [string, string]> = {
  sign_in: ["Signed in", "সাইন ইন"], sign_in_failed: ["Wrong PIN entered", "ভুল পিন দেওয়া হয়েছে"], device_connect: ["Connected a device", "ডিভাইস যুক্ত"], device_disconnect: ["Disconnected a device", "ডিভাইস বিচ্ছিন্ন"], device_branch: ["Moved a device to a branch", "ডিভাইসের শাখা বদল"],
  staff_create: ["Added staff", "কর্মী যোগ"], staff_update: ["Changed staff", "কর্মী পরিবর্তন"], settings_update: ["Changed settings", "সেটিংস পরিবর্তন"],
  product_create: ["Added a product", "পণ্য যোগ"], product_update: ["Changed a product", "পণ্য পরিবর্তন"], product_remove: ["Removed a product", "পণ্য সরানো"], product_photo: ["Changed a photo", "ছবি পরিবর্তন"], product_import: ["Imported products", "পণ্য ইমপোর্ট"],
  supplier_create: ["Added a supplier", "সরবরাহকারী যোগ"], supplier_update: ["Changed a supplier", "সরবরাহকারী পরিবর্তন"], supplier_remove: ["Removed a supplier", "সরবরাহকারী সরানো"], supplier_payment: ["Paid a supplier", "সরবরাহকারীকে পরিশোধ"],
  purchase_create: ["Created a purchase", "ক্রয় তৈরি"], purchase_receive: ["Received goods", "মাল গ্রহণ"], purchase_close: ["Closed an order short", "অর্ডার বন্ধ"], purchase_cancel: ["Cancelled an order", "অর্ডার বাতিল"], purchase_return: ["Returned goods to supplier", "সরবরাহকারীকে ফেরত"], purchase_void: ["Voided a purchase", "ক্রয় বাতিল"],
  customer_create: ["Added a customer", "ক্রেতা যোগ"], customer_update: ["Changed a customer", "ক্রেতা পরিবর্তন"], customer_remove: ["Removed a customer", "ক্রেতা সরানো"], baki_collect: ["Collected baki", "বাকি আদায়"], sale_return: ["Processed a return", "বিক্রি ফেরত"],
  shift_open: ["Opened a shift", "শিফট শুরু"], shift_close: ["Closed a shift", "শিফট বন্ধ"], branch_create: ["Added a branch", "শাখা যোগ"], branch_update: ["Changed a branch", "শাখা পরিবর্তন"], transfer_send: ["Sent a stock transfer", "স্টক পাঠানো"], transfer_receive: ["Received a stock transfer", "স্টক গ্রহণ"], transfer_cancel: ["Cancelled a stock transfer", "স্টক স্থানান্তর বাতিল"],
};

function describe(detail: Record<string, unknown> | null) {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== 0)
    .map(([k, v]) => (/Poisha$/.test(k) && typeof v === "number" ? `${k.replace(/Poisha$/, "")}: ৳${v / 100}` : k === "vatRateBp" && typeof v === "number" ? `VAT: ${v / 100}%` : typeof v === "boolean" ? k : `${k}: ${String(v)}`))
    .join(" · ");
}

export function AuditScreen({ lang, t, online }: { lang: Lang; t: (k: StringKey) => string; online: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next: number) => {
    try {
      const res = await apiFetch(`/v1/audit?page=${next}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { entries: AuditEntry[]; hasMore: boolean };
      setEntries((old) => (next === 1 ? body.entries : [...old, ...body.entries]));
      setHasMore(body.hasMore);
      setPage(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (online) void load(1);
  }, [online, load]);

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-2">
        <h1 className="text-2xl font-black">{t("audit")}</h1>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {failed && online && <p role="alert" className="font-bold text-hot">{t("saveFailed")}</p>}
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="border-[3px] border-line bg-panel p-3">
              <div className="flex justify-between gap-3 font-black">
                <span>{LABELS[e.action]?.[lang === "bn" ? 1 : 0] ?? e.action}</span>
                <span className="shrink-0 text-sm text-muted">{new Date(e.at).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")}</span>
              </div>
              <p className="font-bold text-muted">{e.actorName ?? "—"}{describe(e.detail) ? ` · ${describe(e.detail)}` : ""}</p>
            </li>
          ))}
        </ul>
        {hasMore && <button className="min-h-12 w-full border-[3px] border-line font-black" onClick={() => void load(page + 1)}>{t("loadMore")}</button>}
      </div>
    </main>
  );
}
