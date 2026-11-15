// Sending a receipt or a baki reminder through the customer's own WhatsApp or SMS app. Nothing goes
// through a paid gateway: the shopkeeper's phone opens with the message written, and they press send.
import { dueByMethod, formatQty, formatTaka, lineAmount, type Lang, type Sale } from "@lalcha/domain";

/** 017XXXXXXXX → 88017XXXXXXXX, the form WhatsApp links need. */
const intl = (phone: string) => `88${phone.replace(/\D/g, "").replace(/^88/, "")}`;

/** With no number, WhatsApp asks who to send it to. */
export const whatsappLink = (phone: string | null, text: string) => `https://wa.me/${phone ? intl(phone) : ""}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone: string, text: string) => `sms:+${intl(phone)}?body=${encodeURIComponent(text)}`;

export function bakiReminder(storeName: string, customerName: string, duePoisha: number, lang: Lang) {
  const due = formatTaka(duePoisha, lang);
  return lang === "bn"
    ? `${customerName}, আসসালামু আলাইকুম। ${storeName}-এ আপনার বাকি ${due}। সুবিধামতো পরিশোধ করলে উপকৃত হব। ধন্যবাদ।`
    : `Hello ${customerName}, your due at ${storeName} is ${due}. Please pay when convenient. Thank you.`;
}

export function receiptText(sale: Sale, storeName: string, lang: Lang) {
  const bn = lang === "bn";
  const money = (p: number) => formatTaka(p, lang);
  const rows = [
    `*${storeName}*`,
    `${bn ? "রসিদ" : "Receipt"} #${sale.receiptNo} · ${new Date(sale.soldAt).toLocaleString(bn ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
    "",
    ...sale.lines.map((l) => `${l.name} × ${formatQty(l.qty, l.unit, lang)} = ${money(lineAmount(l.qty, l.unitPricePoisha))}`),
    "",
  ];
  if (sale.discountPoisha > 0) rows.push(`${bn ? "ছাড়" : "Discount"}: −${money(sale.discountPoisha)}`);
  rows.push(`*${bn ? "মোট" : "Total"}: ${money(sale.totalPoisha)}*`);
  if (sale.paymentMethod === "baki") rows.push(`${bn ? "পরিশোধ" : "Paid"}: ${money(sale.tenderedPoisha)}`, `${bn ? "বাকি" : "Due"}: ${money(dueByMethod(sale) - sale.tenderedPoisha)}`);
  rows.push("", bn ? "ধন্যবাদ, আবার আসবেন।" : "Thank you, come again.");
  return rows.join("\n");
}
