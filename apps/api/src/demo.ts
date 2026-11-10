// The public demo store: anyone can open it without a phone code, and it is wiped on a schedule.
import type { Context, Hono } from "hono";
import { and, isNull, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { mainBranchId } from "./branches.ts";
import { DEMO_STAFF, stableUuid } from "./demo-data.ts";
import { withStore, type Env } from "./db.ts";
import { devices } from "./schema.ts";
import { newToken, sha256 } from "./secrets.ts";

const demoStoreId = config.demoSubdomain ? stableUuid(`store:${config.demoSubdomain}`) : null;
export const isDemoStore = (c: Context<Env>) => demoStoreId !== null && c.get("store")?.id === demoStoreId;

/** Enough for many visitors between resets, while stopping one script from filling the table. */
const MAX_DEMO_DEVICES = 3000;

/** Requests that change nothing other visitors see. */
const ALLOWED_WRITES = new Set(["/v1/auth/pin", "/v1/demo/connect"]);

/** Till uploads: answered as saved so the visitor's till stays happy, then thrown away. */
const DISCARDED = new Set(["/v1/sync/sales", "/v1/sync/ops"]);

export function registerDemo(app: Hono<Env>) {
  // Every visitor shares one store, so nobody's changes may reach it. Each browser keeps its own.
  app.use("/v1/*", async (c, next) => {
    if (!isDemoStore(c) || c.req.method === "GET" || c.req.method === "HEAD" || ALLOWED_WRITES.has(c.req.path)) return next();
    if (DISCARDED.has(c.req.path)) {
      const body = (await c.req.json().catch(() => null)) as { sales?: { id?: unknown }[]; ops?: { id?: unknown }[] } | null;
      const items = body?.sales ?? body?.ops ?? [];
      const results = items.map((i) => ({ id: typeof i?.id === "string" ? i.id : null, status: "accepted" as const }));
      return c.json({ results });
    }
    return c.json({ error: "demo_blocked" }, 403);
  });

  app.get("/v1/demo", async (c) => {
    if (!isDemoStore(c)) return c.json({ demo: false });
    const staff = DEMO_STAFF.demo.map(([key, name, , role, pin]) => ({ id: stableUuid(`user:demo:${key}`), name, role, pin }));
    return c.json({ demo: true, staff });
  });

  app.post("/v1/demo/connect", async (c) => {
    if (!isDemoStore(c)) return c.json({ error: "not_found" }, 404);
    const store = c.get("store");
    const token = await withStore(store.id, async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(devices)
        .where(and(eq(devices.storeId, store.id), isNull(devices.revokedAt)));
      if (count >= MAX_DEMO_DEVICES) return null;
      const value = newToken();
      await tx.insert(devices).values({
        storeId: store.id, id: randomUUID(), name: "Demo visitor", tokenHash: sha256(value),
        pairedBy: stableUuid("user:demo:owner"), branchId: await mainBranchId(tx, store.id),
      });
      return value;
    });
    return token ? c.json({ deviceToken: token }) : c.json({ error: "demo_busy" }, 503);
  });
}
