// Scheduled jobs, run from cron on the server:
//   pg_dump -Fc lalcha | node --import tsx src/maintenance.ts backup   encrypt the dump and store it in R2
//   node --import tsx src/maintenance.ts prune                         delete backups past their keep date
//   node --import tsx src/maintenance.ts cleanup                       orphan photos, old attachments, expired codes
//   node --import tsx src/maintenance.ts migrate-images                copy photos from disk to R2 (once)
//   node --import tsx src/maintenance.ts backups                       list what's stored
//   node --import tsx src/maintenance.ts restore <key> > lalcha.dump   decrypt one backup to pg_restore it
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { config } from "./config.ts";
import { platformDb } from "./db.ts";
import { deleteObject, getObject, listObjects, putObject, usingR2 } from "./storage.ts";

const MAGIC = Buffer.from("LALCHA-BACKUP-1\n");
const DAY = 86_400_000;

function key(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** AES-256-GCM: the file is magic, salt, IV, ciphertext, then the 16-byte tag that proves nothing was changed. */
export function encrypt(plain: Buffer, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  return Buffer.concat([MAGIC, salt, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

export function decrypt(file: Buffer, passphrase: string) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Lalcha backup");
  let at = MAGIC.length;
  const salt = file.subarray(at, (at += 16));
  const iv = file.subarray(at, (at += 12));
  const tag = file.subarray(file.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(file.subarray(at, file.length - 16)), decipher.final()]);
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function needR2() {
  if (!usingR2) throw new Error("R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)");
}

async function backup() {
  needR2();
  if (!config.backupPassphrase) throw new Error("BACKUP_PASSPHRASE is not set");
  const dump = await readStdin();
  // pg_dump's custom format starts with PGDMP; anything else means the dump failed upstream.
  if (dump.length < 100 || dump.subarray(0, 5).toString() !== "PGDMP") throw new Error(`dump looks wrong (${dump.length} bytes)`);
  const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 16);
  const name = `backups/db/lalcha-${stamp}.dump.enc`;
  await putObject(name, encrypt(dump, config.backupPassphrase), "application/octet-stream");
  console.log(`backup stored: ${name} (${(dump.length / 1024 / 1024).toFixed(1)} MB before encryption)`);
}

/** Keeps every backup from the last few days, then the first one of each month for a year. */
export function backupsToDelete(keys: { key: string; lastModified: Date }[], now = Date.now(), dailyDays = config.backupDailyDays, months = config.backupMonthlyMonths) {
  const firstOfMonth = new Map<string, string>();
  for (const k of [...keys].sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())) {
    const month = k.lastModified.toISOString().slice(0, 7);
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, k.key);
  }
  const monthlyCutoff = new Date(now);
  monthlyCutoff.setUTCMonth(monthlyCutoff.getUTCMonth() - months);
  const keepMonthly = new Set([...firstOfMonth.entries()].filter(([m]) => m >= monthlyCutoff.toISOString().slice(0, 7)).map(([, k]) => k));
  return keys.filter((k) => now - k.lastModified.getTime() > dailyDays * DAY && !keepMonthly.has(k.key)).map((k) => k.key);
}

async function prune() {
  needR2();
  const all = await listObjects("backups/db/");
  const doomed = backupsToDelete(all);
  // Never delete the only backups left, whatever their dates say.
  if (doomed.length >= all.length) throw new Error("refusing to delete every backup");
  for (const k of doomed) await deleteObject(k);
  console.log(`backups: ${all.length} stored, ${doomed.length} deleted`);
}

async function cleanup() {
  // Expired one-time codes and long-dead sessions serve no purpose and hold personal data.
  await platformDb.execute(sql`delete from login_codes where expires_at < now() - interval '1 day'`);
  await platformDb.execute(sql`delete from signup_codes where expires_at < now() - interval '1 day'`);
  await platformDb.execute(sql`delete from platform_codes where expires_at < now() - interval '1 day'`);
  await platformDb.execute(sql`delete from platform_sessions where expires_at < now() - interval '30 days'`);
  if (!usingR2) return console.log("cleanup: codes done; R2 not configured, so no file cleanup");

  // Photos no product points at any more (replaced, or upload abandoned). A week's grace covers uploads in flight.
  const used = new Set(((await platformDb.execute(sql`select image_url from products where image_url is not null`)) as unknown as { image_url: string }[]).map((r) => r.image_url.slice(1)));
  let photos = 0;
  for (const o of await listObjects("products/")) {
    if (o.key.split("/").length !== 3 || used.has(o.key) || Date.now() - o.lastModified.getTime() < 7 * DAY) continue;
    await deleteObject(o.key);
    photos++;
  }

  // Attachments past their keep date: the file goes, the message and the file's name stay.
  const old = (await platformDb.execute(sql`
    select id, attachments from platform_mail
    where attachments like '%"key"%' and created_at < now() - make_interval(days => ${config.attachmentRetentionDays})
  `)) as unknown as { id: string; attachments: string }[];
  for (const m of old) {
    const list = JSON.parse(m.attachments) as { filename: string; size: number; key?: string }[];
    for (const a of list) if (a.key) await deleteObject(a.key);
    await platformDb.execute(sql`update platform_mail set attachments = ${JSON.stringify(list.map(({ key: _k, ...rest }) => ({ ...rest, expired: true })))} where id = ${m.id}`);
  }
  console.log(`cleanup: ${photos} unused photos and ${old.length} old messages' attachments removed`);
}

async function migrateImages() {
  needR2();
  const root = fileURLToPath(new URL("../public/products/", import.meta.url));
  let copied = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name);
      if ((await stat(path)).isDirectory()) await walk(path, `${prefix}${name}/`);
      else if (/\.(jpg|png|webp|svg)$/i.test(name)) {
        const type = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
        if (!(await getObject(`${prefix}${name}`))) {
          await putObject(`${prefix}${name}`, await readFile(path), type);
          copied++;
        }
      }
    }
  };
  await walk(root, "products/");
  console.log(`images copied to R2: ${copied}`);
}

async function restore(name: string | undefined) {
  needR2();
  if (!name) throw new Error("usage: restore <backups/db/...>");
  if (!config.backupPassphrase) throw new Error("BACKUP_PASSPHRASE is not set");
  const found = await getObject(name);
  if (!found) throw new Error(`no such backup: ${name}`);
  process.stdout.write(decrypt(Buffer.from(found.body), config.backupPassphrase));
}

const jobs: Record<string, (arg?: string) => Promise<void>> = {
  backup,
  prune,
  cleanup,
  "migrate-images": migrateImages,
  restore,
  backups: async () => {
    needR2();
    for (const o of await listObjects("backups/db/")) console.log(`${o.lastModified.toISOString()}  ${(o.size / 1024 / 1024).toFixed(1)} MB  ${o.key}`);
  },
};

const job = jobs[process.argv[2] ?? ""];
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("maintenance.ts")) {
  if (!job) {
    console.error(`usage: maintenance.ts ${Object.keys(jobs).join(" | ")}`);
    process.exit(2);
  }
  job(process.argv[3]).then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
