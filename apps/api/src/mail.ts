// Outgoing mail goes through Postal on the same server: login codes, and replies from the company inbox.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "./config.ts";

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
/** Implicit TLS from the first byte: Cloudflare's relay offers nothing else on 465. */
const codesTransport = config.codesSmtp
  ? nodemailer.createTransport({ host: config.codesSmtp.host, port: config.codesSmtp.port, secure: config.codesSmtp.port === 465, auth: { user: config.codesSmtp.user, pass: config.codesSmtp.pass } })
  : null;

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  /** An HTML version alongside the text. Mail with both parts is trusted more than bare text. */
  html?: string;
  /** Defaults to MAIL_FROM. Inbox replies send from hello@, support@ and so on. */
  from?: string;
  /** Where a reply should go, when the sending address isn't one that receives mail. */
  replyTo?: string;
  /** "codes" sends through the relay set up for login codes, when there is one. */
  lane?: "codes";
  inReplyTo?: string | null;
  references?: string | null;
};

/** Sends one message and returns its Message-ID. Without SMTP in development it is printed here instead. */
export async function sendMail(mail: OutgoingMail): Promise<string> {
  const messageId = `<${randomUUID()}@${config.mailDomain}>`;
  const relay = mail.lane === "codes" && codesTransport ? codesTransport : transport;
  if (!relay) {
    if (config.isProduction) throw new Error("SMTP_URL is not set");
    console.log(`[mail] from ${mail.from ?? config.mailFrom} to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return messageId;
  }
  await relay.sendMail({
    from: mail.from ?? config.mailFrom,
    replyTo: mail.replyTo,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    messageId,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references ?? undefined,
  });
  return messageId;
}

const isEmail = (contact: string) => contact.includes("@");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * One message in both languages, since the code can arrive before we know which one the person reads.
 * A plain, branded layout with both parts and a real reply address: bare one-line code mails are what
 * phishing looks like, and Gmail files them as spam more often.
 */
export async function sendCode(contact: string, code: string, purpose: string) {
  if (!isEmail(contact)) {
    // SMS is deliberately not faked in production: it fails loudly until a provider is connected.
    if (config.isProduction) throw new Error("SMS provider is not configured");
    return;
  }
  const site = `https://${config.mailDomain}`;
  const help = `support@${config.mailDomain}`;
  const text = [
    "Lalcha POS",
    "",
    `আপনার কোড: ${code}`,
    `${purpose}। কোডটি ৫ মিনিট কাজ করবে।`,
    "আপনি এটি না চাইলে ইমেইলটি এড়িয়ে যান। কেউ আপনার অ্যাকাউন্টে ঢুকতে পারবে না।",
    "",
    `Your code: ${code}`,
    "It works for 5 minutes. If you didn't ask for it, you can ignore this email; nobody can get in without it.",
    "",
    `Need help? Reply to this email or write to ${help}.`,
    site,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f7f4ea;font-family:Arial,Helvetica,sans-serif;color:#12130f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fffdf6;border:3px solid #12130f">
<tr><td style="background:#d7ff3f;padding:14px 20px;font-size:20px;font-weight:bold;border-bottom:3px solid #12130f">Lalcha POS</td></tr>
<tr><td style="padding:24px 20px">
<p style="margin:0 0 6px;font-size:16px">আপনার কোড · Your code</p>
<p style="margin:0 0 18px;font-size:36px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${escapeHtml(purpose)}। কোডটি ৫ মিনিট কাজ করবে। আপনি এটি না চাইলে ইমেইলটি এড়িয়ে যান।</p>
<p style="margin:0 0 10px;font-size:15px;line-height:1.5">It works for 5 minutes. If you didn't ask for it, you can ignore this email; nobody can get in without it.</p>
<p style="margin:18px 0 0;font-size:13px;color:#5d5c50">Need help? Reply to this email or write to <a href="mailto:${help}" style="color:#12130f">${help}</a>.<br><a href="${site}" style="color:#12130f">${site.replace("https://", "")}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  await sendMail({
    to: contact, subject: `Your Lalcha POS code: ${code}`, text, html, lane: "codes",
    // The relay's sending address doesn't receive mail, so replies go to the company inbox.
    ...(codesTransport ? { from: config.codesFrom, replyTo: `hello@${config.mailDomain}` } : {}),
  });
}
