// Emails the people who run Lalcha when something on the server needs them. Used by ops/lalcha-watch:
//   echo "details" | node --import tsx src/alert.ts "Backup failed"
// It goes through the login-code relay (outside this server), so it still arrives when local mail is down.
import { config } from "./config.ts";
import { sendMail } from "./mail.ts";

const subject = process.argv[2] ?? "Alert";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const text = `${Buffer.concat(chunks).toString("utf8").slice(0, 8000).trim() || "(no details)"}\n\nSent by the watcher on the Lalcha server at ${new Date().toISOString()}.`;
const to = (process.env.ALERT_EMAILS ?? config.platformAdmins.join(",")).split(",").map((e) => e.trim()).filter(Boolean);
for (const address of to) {
  await sendMail({ to: address, subject: `[Lalcha] ${subject}`, text, lane: "codes", ...(config.codesSmtp ? { from: config.codesFrom, replyTo: `hello@${config.mailDomain}` } : {}) });
}
console.log(`Alert sent to ${to.length} address(es): ${subject}`);
process.exit(0);
