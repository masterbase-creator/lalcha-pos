// The company inbox, built like Outclarity's: Postal receives mail for @lalcha.com and posts each
// message here; the superadmin panel reads it and replies through Postal. There are no mailboxes to run.
import { mailSendSchema, type MailboxInfo, type PlatformMail, type PlatformMailSummary } from "@lalcha/domain";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { config } from "./config.ts";
import { platformDb, type Env } from "./db.ts";
import { ApiError, guarded, PAGE_SIZE, pageOf, parse } from "./http.ts";
import { sendMail } from "./mail.ts";
import { platformAudit, platformMail } from "./schema.ts";
import { safeEqual, sha256 } from "./secrets.ts";

/** "Rahim <rahim@example.com>" → its name and address. */
function splitAddress(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || null, address: match[2].trim().toLowerCase() };
  return { name: null, address: value.toLowerCase() };
}

/** Which of our addresses a message reached: "support" for support@lalcha.com. */
function mailboxOf(rcptTo: string) {
  const [local, domain] = rcptTo.toLowerCase().split("@");
  return domain === config.mailDomain ? local : rcptTo.toLowerCase();
}

const preview = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

/** What Postal sends for each message in its JSON "Hash" format. Anything else in it is ignored. */
const postalMessage = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  rcpt_to: z.string().max(320),
  mail_from: z.string().max(320).optional().default(""),
  from: z.string().max(1000).optional().default(""),
  to: z.string().max(5000).optional().default(""),
  subject: z.string().max(2000).nullable().optional().default(""),
  message_id: z.string().max(1000).nullable().optional(),
  in_reply_to: z.string().max(1000).nullable().optional(),
  references: z.string().max(5000).nullable().optional(),
  plain_body: z.string().max(500_000).nullable().optional(),
  html_body: z.string().max(2_000_000).nullable().optional(),
  attachments: z.array(z.object({ filename: z.string().max(500).nullable().optional(), size: z.number().optional() }).passthrough()).optional().default([]),
});

const toSummary = (r: typeof platformMail.$inferSelect): PlatformMailSummary => ({
  id: r.id, direction: r.direction, mailbox: r.mailbox, fromAddress: r.fromAddress, fromName: r.fromName, toAddress: r.toAddress,
  subject: r.subject, preview: preview(r.textBody), read: r.readAt !== null || r.direction === "out", createdAt: r.createdAt.toISOString(),
});

export function registerInbox(app: Hono<Env>) {
  // Postal posts here over loopback. The token in the URL is the only key; without one the route doesn't exist.
  app.post(
    "/v1/mail/inbound",
    guarded(async (c) => {
      const token = config.mailWebhookToken;
      if (!token || !safeEqual(sha256(c.req.query("k") ?? ""), sha256(token))) throw new ApiError("not_found", 404);
      const m = postalMessage.parse(await c.req.json());
      const from = splitAddress(m.from || m.mail_from);
      const attachments = m.attachments.map((a) => ({ filename: a.filename ?? "attachment", size: a.size ?? 0 }));
      await platformDb
        .insert(platformMail)
        .values({
          direction: "in",
          mailbox: mailboxOf(m.rcpt_to),
          fromAddress: from.address || m.mail_from.toLowerCase(),
          fromName: from.name,
          toAddress: m.rcpt_to.toLowerCase(),
          subject: m.subject ?? "",
          textBody: m.plain_body ?? "",
          htmlBody: m.html_body ?? null,
          messageId: m.message_id ?? null,
          inReplyTo: m.in_reply_to ?? null,
          references: m.references ?? null,
          attachments: attachments.length ? JSON.stringify(attachments) : null,
          postalId: m.id,
        })
        .onConflictDoNothing({ target: platformMail.postalId });
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/platform/mailboxes",
    guarded(async (c) => {
      const rows = (await platformDb.execute(sql`
        select mailbox, count(*)::int as unread from platform_mail where direction = 'in' and read_at is null group by mailbox
      `)) as unknown as { mailbox: string; unread: number }[];
      const unread = new Map(rows.map((r) => [r.mailbox, r.unread]));
      // Mail can arrive for addresses that aren't in the list (a typo, an old address), so those show too.
      const names = [...new Set([...config.mailboxes, ...unread.keys()])];
      return c.json<{ mailboxes: MailboxInfo[]; domain: string }>({
        domain: config.mailDomain,
        mailboxes: names.map((name) => ({ name, address: name.includes("@") ? name : `${name}@${config.mailDomain}`, unread: unread.get(name) ?? 0 })),
      });
    }),
  );

  app.get(
    "/v1/platform/mail",
    guarded(async (c) => {
      const box = (c.req.query("box") ?? "").trim().toLowerCase().slice(0, 320);
      const page = pageOf(c);
      const rows = await platformDb
        .select()
        .from(platformMail)
        .where(box ? eq(platformMail.mailbox, box) : undefined)
        .orderBy(desc(platformMail.createdAt))
        .limit(PAGE_SIZE + 1)
        .offset(page.offset);
      return c.json({ mail: rows.slice(0, PAGE_SIZE).map(toSummary), hasMore: rows.length > PAGE_SIZE });
    }),
  );

  app.get(
    "/v1/platform/mail/:id",
    guarded(async (c) => {
      const id = z.string().uuid().safeParse(c.req.param("id"));
      if (!id.success) throw new ApiError("not_found", 404);
      const [row] = await platformDb.update(platformMail).set({ readAt: sql`coalesce(${platformMail.readAt}, now())` }).where(eq(platformMail.id, id.data)).returning();
      if (!row) throw new ApiError("not_found", 404);
      // The whole conversation with this person, oldest first, so a reply has its context.
      const other = row.direction === "in" ? row.fromAddress : row.toAddress;
      const thread = await platformDb
        .select()
        .from(platformMail)
        .where(or(and(eq(platformMail.direction, "in"), eq(platformMail.fromAddress, other)), and(eq(platformMail.direction, "out"), eq(platformMail.toAddress, other))))
        .orderBy(platformMail.createdAt)
        .limit(50);
      const full = (r: typeof platformMail.$inferSelect): PlatformMail => ({
        ...toSummary(r), textBody: r.textBody, htmlBody: r.htmlBody, messageId: r.messageId, inReplyTo: r.inReplyTo,
        attachments: r.attachments ? (JSON.parse(r.attachments) as { filename: string; size: number }[]) : [], sentBy: r.sentBy,
      });
      return c.json({ mail: full(row), thread: thread.map(full) });
    }),
  );

  app.post(
    "/v1/platform/mail/:id/unread",
    guarded(async (c) => {
      const id = z.string().uuid().safeParse(c.req.param("id"));
      if (!id.success) throw new ApiError("not_found", 404);
      await platformDb.update(platformMail).set({ readAt: null }).where(eq(platformMail.id, id.data));
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/platform/mail/send",
    guarded(async (c) => {
      const input = await parse(c, mailSendSchema);
      if (!config.mailboxes.includes(input.from)) throw new ApiError("invalid_mailbox");
      const fromAddress = `${input.from}@${config.mailDomain}`;
      let inReplyTo: string | null = null;
      let references: string | null = null;
      if (input.replyTo) {
        const [original] = await platformDb.select().from(platformMail).where(eq(platformMail.id, input.replyTo));
        if (!original) throw new ApiError("not_found", 404);
        inReplyTo = original.messageId;
        references = [original.references, original.messageId].filter(Boolean).join(" ") || null;
      }
      const messageId = await sendMail({ from: `Lalcha POS <${fromAddress}>`, to: input.to, subject: input.subject, text: input.text, inReplyTo, references });
      const actor = c.get("platformAdmin");
      const [row] = await platformDb
        .insert(platformMail)
        .values({ direction: "out", mailbox: input.from, fromAddress, fromName: "Lalcha POS", toAddress: input.to, subject: input.subject, textBody: input.text, messageId, inReplyTo, references, sentBy: actor, readAt: new Date() })
        .returning({ id: platformMail.id });
      await platformDb.insert(platformAudit).values({ actor, action: "mail_send", detail: `${fromAddress} → ${input.to}: ${input.subject.slice(0, 120)}` });
      return c.json({ id: row.id }, 201);
    }),
  );
}

