import type { Context, Next } from "hono";
import type { Env } from "./db.ts";

/**
 * A cap on how often one visitor may hit the sign-in endpoints. Each code already has its own limits
 * (one email a minute, a few wrong tries), but those are per address: without this, one computer
 * could ask for codes for thousands of addresses, or guess PINs across many staff.
 *
 * Counts live in memory. That is enough for one API process; restart forgets them, which is harmless.
 */
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

/** nginx puts the visitor's real address here (taken from Cloudflare). Never trust it from the open internet: the origin only accepts Cloudflare. */
export const clientIp = (c: Context<Env>) => c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key);
}, 60_000).unref();

/** Sending mail costs money and reputation, so it gets the tightest cap; checking codes and PINs a looser one. */
const RULES: { test: RegExp; name: string; max: number }[] = [
  { test: /\/(request-code|request)$/, name: "send", max: 20 },
  { test: /^\/v1\/public\/signup$/, name: "signup", max: 6 },
  { test: /\/(verify|verify-code|confirm|open|handoff|pin|connect)$/, name: "check", max: 120 },
  { test: /^\/v1\/public\/subdomain$/, name: "lookup", max: 240 },
];

export async function rateLimit(c: Context<Env>, next: Next) {
  const path = c.req.path;
  if (!(path.startsWith("/v1/auth/") || path.startsWith("/v1/public/") || path.startsWith("/v1/platform/auth/") || path === "/v1/demo/connect")) return next();
  const rule = RULES.find((r) => r.test.test(path));
  if (!rule) return next();
  const key = `${rule.name}:${clientIp(c)}`;
  const now = Date.now();
  const hit = hits.get(key);
  if (!hit || hit.resetAt <= now) hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else if (++hit.count > rule.max) {
    c.header("Retry-After", String(Math.ceil((hit.resetAt - now) / 1000)));
    return c.json({ error: "too_many_requests" }, 429);
  }
  return next();
}
