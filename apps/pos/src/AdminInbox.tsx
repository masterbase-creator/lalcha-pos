import type { MailboxInfo, PlatformMail, PlatformMailSummary } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";

const small = "min-h-11 border-[3px] border-line px-3 font-black";
const field = "mt-1 w-full border-[3px] border-line bg-bg px-3 font-bold";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const who = (m: PlatformMailSummary) => (m.direction === "in" ? m.fromName || m.fromAddress : `To ${m.toAddress}`);

/** HTML mail is shown in a sandbox with no scripts, forms or same-origin access, so a message can't act as the admin. */
function HtmlBody({ html }: { html: string }) {
  return <iframe title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank"><style>body{font-family:system-ui,sans-serif;margin:8px;color:#12130f}img{max-width:100%}</style>${html}`} className="h-96 w-full border-2 border-line/30 bg-white" />;
}

type Draft = { replyTo: string | null; from: string; to: string; subject: string; text: string };

/** The company inbox: mail to @lalcha.com, read and answered here. */
export function AdminInbox({ session, onUnread }: { session: string; onUnread: (n: number) => void }) {
  const headers = { "x-platform-session": session };
  const [boxes, setBoxes] = useState<MailboxInfo[]>([]);
  const [box, setBox] = useState("");
  const [list, setList] = useState<PlatformMailSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ mail: PlatformMail; thread: PlatformMail[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadBoxes = useCallback(async () => {
    const res = await fetch("/v1/platform/mailboxes", { headers: { "x-platform-session": session } }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { mailboxes: MailboxInfo[] };
    setBoxes(body.mailboxes);
    onUnread(body.mailboxes.reduce((n, b) => n + b.unread, 0));
  }, [session, onUnread]);

  const loadList = useCallback(async (b: string, p: number) => {
    const res = await fetch(`/v1/platform/mail?box=${encodeURIComponent(b)}&page=${p}`, { headers: { "x-platform-session": session } }).catch(() => null);
    if (!res?.ok) return setError("Could not load mail.");
    const body = (await res.json()) as { mail: PlatformMailSummary[]; hasMore: boolean };
    setList((old) => (p === 1 ? body.mail : [...old, ...body.mail]));
    setHasMore(body.hasMore);
    setPage(p);
  }, [session]);

  useEffect(() => {
    void loadBoxes();
    void loadList(box, 1);
    // New mail shows up without a refresh.
    const timer = window.setInterval(() => { void loadBoxes(); if (!open) void loadList(box, 1); }, 30_000);
    return () => window.clearInterval(timer);
  }, [box, open, loadBoxes, loadList]);

  async function openMail(id: string) {
    setError("");
    setNotice("");
    setDraft(null);
    const res = await fetch(`/v1/platform/mail/${id}`, { headers }).catch(() => null);
    if (!res?.ok) return setError("Could not open that message.");
    setOpen((await res.json()) as { mail: PlatformMail; thread: PlatformMail[] });
    void loadBoxes();
  }

  function reply(m: PlatformMail) {
    const ours = boxes.map((b) => b.name);
    const from = ours.includes(m.mailbox) ? m.mailbox : (ours[0] ?? "hello");
    const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
    const quoted = m.textBody.split("\n").map((l) => `> ${l}`).join("\n");
    setDraft({ replyTo: m.id, from, to: m.direction === "in" ? m.fromAddress : m.toAddress, subject, text: `\n\nOn ${when(m.createdAt)}, ${m.fromName || m.fromAddress} wrote:\n${quoted}` });
  }

  async function send() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/v1/platform/mail/send", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(draft) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      return setError(body?.error === "invalid_email" ? "That email address isn't valid." : "Sending failed. Nothing was sent.");
    }
    setNotice(`Sent to ${draft.to}.`);
    const replyTo = draft.replyTo;
    setDraft(null);
    if (replyTo && open) await openMail(open.mail.id);
    else await loadList(box, 1);
  }

  async function markUnread(id: string) {
    await fetch(`/v1/platform/mail/${id}/unread`, { method: "POST", headers }).catch(() => null);
    setOpen(null);
    await Promise.all([loadBoxes(), loadList(box, 1)]);
  }

  const composer = draft && (
    <form className="space-y-2 border-[3px] border-line bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <h3 className="text-lg font-black">{draft.replyTo ? "Reply" : "New message"}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block font-bold">From
          <select value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={`${field} h-12`}>
            {boxes.filter((b) => !b.name.includes("@")).map((b) => <option key={b.name} value={b.name}>{b.address}</option>)}
          </select>
        </label>
        <label className="block font-bold">To<input required type="email" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={`${field} h-12`} /></label>
      </div>
      <label className="block font-bold">Subject<input required maxLength={300} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={`${field} h-12`} /></label>
      <label className="block font-bold">Message<textarea required autoFocus rows={10} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className={`${field} py-2`} /></label>
      <div className="flex gap-2">
        <button type="button" className={`${small} flex-1`} onClick={() => setDraft(null)}>Discard</button>
        <button disabled={busy} className="min-h-12 flex-[2] bg-accent font-black text-on-accent disabled:opacity-40">{busy ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );

  if (open) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button className={small} onClick={() => { setOpen(null); setDraft(null); void loadList(box, 1); }}>← Inbox</button>
          <button className={small} onClick={() => void markUnread(open.mail.id)}>Mark unread</button>
        </div>
        <h2 className="text-2xl font-black break-words">{open.mail.subject || "(no subject)"}</h2>
        {open.thread.map((m) => (
          <article key={m.id} className={`space-y-2 border-[3px] p-3 ${m.id === open.mail.id ? "border-hot bg-panel" : "border-line bg-panel/60"}`}>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-black">{m.direction === "in" ? `${m.fromName ? `${m.fromName} · ` : ""}${m.fromAddress}` : `${m.fromAddress} → ${m.toAddress}`}</span>
              <span className="text-sm font-bold text-muted">{when(m.createdAt)}{m.sentBy ? ` · sent by ${m.sentBy}` : ""} · {m.direction === "in" ? `to ${m.toAddress}` : "sent"}</span>
            </header>
            {m.htmlBody ? <HtmlBody html={m.htmlBody} /> : <pre className="font-sans whitespace-pre-wrap break-words">{m.textBody}</pre>}
            {m.attachments.length > 0 && <p className="text-sm font-bold text-muted">Attachments (not kept): {m.attachments.map((a) => a.filename).join(", ")}</p>}
            <button className={small} onClick={() => reply(m)}>Reply</button>
          </article>
        ))}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        {notice && <p role="status" className="font-bold">{notice}</p>}
        {composer}
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {[{ name: "", address: "All mail", unread: boxes.reduce((n, b) => n + b.unread, 0) }, ...boxes].map((b) => (
          <button key={b.name || "all"} aria-pressed={box === b.name} onClick={() => setBox(b.name)} className={`min-h-10 border-2 border-line px-3 font-bold ${box === b.name ? "bg-text text-bg" : "bg-panel"}`}>
            {b.name ? b.address : b.address}{b.unread ? ` (${b.unread})` : ""}
          </button>
        ))}
        <button className="ml-auto min-h-11 bg-accent px-4 font-black text-on-accent" onClick={() => { setNotice(""); setDraft({ replyTo: null, from: boxes.find((b) => b.name === box && !b.name.includes("@"))?.name ?? boxes[0]?.name ?? "hello", to: "", subject: "", text: "" }); }}>New message</button>
      </div>
      {error && <p role="alert" className="font-bold text-hot">{error}</p>}
      {notice && <p role="status" className="font-bold">{notice}</p>}
      {composer}
      {list.length === 0 && <p className="p-6 text-center font-bold text-muted">No mail here yet.</p>}
      {list.map((m) => (
        <button key={m.id} onClick={() => void openMail(m.id)} className={`flex w-full flex-col gap-0.5 border-[3px] border-line p-3 text-left ${m.read ? "bg-panel/60" : "bg-panel"}`}>
          <span className="flex w-full justify-between gap-2">
            <span className={`truncate ${m.read ? "font-bold" : "font-black"}`}>{!m.read && <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-hot" aria-label="Unread" />}{who(m)}</span>
            <span className="shrink-0 text-sm font-bold text-muted">{when(m.createdAt)}</span>
          </span>
          <span className={`truncate ${m.read ? "font-bold" : "font-black"}`}>{m.subject || "(no subject)"}</span>
          <span className="truncate text-sm text-muted">{m.mailbox}@ · {m.preview}</span>
        </button>
      ))}
      {hasMore && <button className={`${small} w-full`} onClick={() => void loadList(box, page + 1)}>Load more</button>}
    </section>
  );
}
