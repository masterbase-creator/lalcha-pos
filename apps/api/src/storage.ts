// Files: product photos, inbox attachments and database backups. With R2 configured they live in a
// private Cloudflare R2 bucket and are served through this API (Cloudflare caches the photos at the
// edge); without it, a local folder is used, which is enough for development.
import { AwsClient } from "aws4fetch";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { config } from "./config.ts";
import type { Env } from "./db.ts";

const localRoot = fileURLToPath(new URL("../public/", import.meta.url));
const r2 = config.r2
  ? { client: new AwsClient({ accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey, service: "s3", region: "auto" }), base: `https://${config.r2.accountId}.r2.cloudflarestorage.com/${config.r2.bucket}` }
  : null;

export const usingR2 = r2 !== null;

/** Keys are made by this code, but a stray "../" must never reach outside the bucket or folder. */
function safeKey(key: string) {
  const clean = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (clean.startsWith("/") || clean.includes("..") || !clean) throw new Error(`bad storage key: ${key}`);
  return clean;
}
const objectUrl = (key: string) => `${r2!.base}/${safeKey(key).split("/").map(encodeURIComponent).join("/")}`;

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  if (r2) {
    const res = await r2.client.fetch(objectUrl(key), { method: "PUT", body: new Uint8Array(body), headers: { "content-type": contentType, "content-length": String(body.byteLength) } });
    if (!res.ok) throw new Error(`R2 put ${key}: ${res.status} ${await res.text()}`);
    return;
  }
  const path = join(localRoot, safeKey(key));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

/** The object's bytes and type, or null when it doesn't exist. */
export async function getObject(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  if (r2) {
    const res = await r2.client.fetch(objectUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 get ${key}: ${res.status}`);
    return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
  try {
    const buf = await readFile(join(localRoot, safeKey(key)));
    return { body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  if (r2) {
    const res = await r2.client.fetch(objectUrl(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${key}: ${res.status}`);
    return;
  }
  await rm(join(localRoot, safeKey(key)), { force: true });
}

export type StoredObject = { key: string; size: number; lastModified: Date };

/** Every object under a prefix, following R2's pages. Local storage lists nothing (cleanup is an R2 job). */
export async function listObjects(prefix: string): Promise<StoredObject[]> {
  if (!r2) return [];
  const out: StoredObject[] = [];
  let token: string | null = null;
  do {
    const params = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) params.set("continuation-token", token);
    const res = await r2.client.fetch(`${r2.base}?${params}`);
    if (!res.ok) throw new Error(`R2 list ${prefix}: ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const pick = (tag: string) => m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
      out.push({ key: decodeXml(pick("Key")), size: Number(pick("Size")), lastModified: new Date(pick("LastModified")) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "") || null : null;
  } while (token);
  return out;
}
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Saves a product photo and returns the address the tills use for it. */
export async function saveProductImage(storeId: string, fileName: string, bytes: Buffer) {
  await putObject(`products/${storeId}/${fileName}`, bytes, IMAGE_TYPES[fileName.split(".").pop() ?? ""] ?? "application/octet-stream");
  return `/products/${storeId}/${fileName}`;
}

/** Only the store's own uploads are removed; shared sample pictures stay. */
export async function removeProductImage(storeId: string, url: string) {
  if (!url.startsWith(`/products/${storeId}/`)) return;
  await deleteObject(url.slice(1)).catch((e) => console.error("photo cleanup failed", e));
}

export function registerStorage(app: Hono<Env>) {
  const local = serveStatic({ root: localRoot });
  app.get("/products/*", async (c, next) => {
    if (!r2) return local(c, next);
    const key = c.req.path.slice(1);
    if (!/^products\/[0-9a-z-]+\/[0-9a-z-]+\.(jpg|png|webp)$/i.test(key) && !/^products\/[a-z0-9_-]+\.(jpg|png|webp|svg)$/i.test(key)) return c.notFound();
    const found = await getObject(key);
    if (found) {
      const ext = key.split(".").pop()!.toLowerCase();
      // File names never repeat, so a photo can be cached for good.
      return new Response(found.body, { headers: { "content-type": IMAGE_TYPES[ext] ?? found.contentType, "cache-control": "public, max-age=31536000, immutable" } });
    }
    // Photos uploaded before R2 was switched on are still on disk until they are copied over.
    const path = join(localRoot, safeKey(key));
    if (await stat(path).then(() => true, () => false)) return local(c, next);
    return c.notFound();
  });
}
