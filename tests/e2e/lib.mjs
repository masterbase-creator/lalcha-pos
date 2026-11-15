// Shared helpers for the end-to-end tests. They talk to a running Lalcha the same way a till does.
//
//   Local:  pnpm start            (then)  pnpm e2e
//   Live:   E2E_SCHEME=https E2E_DOMAIN=lalcha.com E2E_EMAIL=you@yourdomain E2E_CODE_CMD='…prints the code…' pnpm e2e
//
// A local server hands back sign-in codes in its replies. A live one never does: there the code goes
// to E2E_EMAIL, and E2E_CODE_CMD is a command that prints it (or type it when asked).
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

export const SCHEME = process.env.E2E_SCHEME ?? "http";
export const DOMAIN = process.env.E2E_DOMAIN ?? "localhost:8787";
export const LIVE = SCHEME === "https";
export const uuid = randomUUID;
export const taka = (n) => Math.round(n * 100);
export const qty = (n) => Math.round(n * 1000);

let passed = 0;
export function ok(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}
export const step = (title) => console.log(`\n${title}`);
export const done = (name) => console.log(`\n${name}: all ${passed} checks passed.`);

/** A connection to one address: the main site (no subdomain) or one store. Remembers the device and the signed-in person. */
export function client(subdomain) {
  const base = `${SCHEME}://${subdomain ? `${subdomain}.` : ""}${DOMAIN}`;
  const state = { device: "", session: "" };
  async function call(method, path, body, expect = 200) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(state.device ? { authorization: `Bearer ${state.device}` } : {}), ...(state.session ? { "x-session": state.session } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    const wanted = Array.isArray(expect) ? expect : [expect];
    if (!wanted.includes(res.status)) throw new Error(`${method} ${path} → ${res.status} (expected ${wanted.join(" or ")}) ${JSON.stringify(data)}`);
    return data ?? {};
  }
  return { base, state, call, get: (p, e) => call("GET", p, null, e), post: (p, b, e) => call("POST", p, b ?? {}, e), put: (p, b, e) => call("PUT", p, b ?? {}, e), del: (p, e) => call("DELETE", p, null, e) };
}

/** The emailed code: straight from a local server's reply, else from E2E_CODE_CMD, else typed in. */
export async function codeFrom(reply, what) {
  if (reply.devCode) return reply.devCode;
  if (process.env.E2E_CODE_CMD) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      const out = execSync(process.env.E2E_CODE_CMD, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (/^\d{6}$/.test(out)) return out;
    }
    throw new Error(`No code arrived for: ${what}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`Code emailed for "${what}": `)).trim();
  rl.close();
  return typed;
}

/** One line of a sale, priced the way the till prices it. */
export const line = (product, pieces, unitPricePoisha = product.pricePoisha) => ({ productId: product.id, name: product.nameEn, qty: qty(pieces), unitPricePoisha, unit: product.unit ?? "pc" });
export const lineTotal = (l) => Math.round((l.qty * l.unitPricePoisha) / 1000);
let receipt = 0;
export function sale(lines, more = {}) {
  const totalPoisha = lines.reduce((n, l) => n + lineTotal(l), 0) - (more.discountPoisha ?? 0);
  receipt += 1;
  return { id: uuid(), deviceId: "e2e", receiptNo: `E2E-${Date.now()}-${receipt}`, soldAt: new Date().toISOString(), lines, discountPoisha: 0, totalPoisha, paymentMethod: "cash", tenderedPoisha: totalPoisha, paymentRef: null, ...more };
}
export const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
