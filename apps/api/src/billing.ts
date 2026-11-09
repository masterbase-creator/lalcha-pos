import {
  billingPaymentSchema,
  DEFAULT_SETTINGS,
  storeSettingsSchema,
  type StoreSettings,
  phoneSchema,
  planById,
  signupSchema,
  subdomainSchema,
  subscriptionState,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type BillingResponse,
  type PlatformPayment,
  type PlatformStore,
  type SubscriptionInfo,
} from "@lalcha/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Hono, MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDevice, requireRole, requireSession, sendLoginCode } from "./auth.ts";
import { config } from "./config.ts";
import { db, pgCode, platformDb, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, parse } from "./http.ts";
import { signupCodes, storeSettings, stores, subscriptionPayments, subscriptions, users } from "./schema.ts";
import { hashPin, newCode, safeEqual, sha256 } from "./secrets.ts";

const CODE_TTL_MS = 5 * 60_000;
const CODE_RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;

const signupHash = (phone: string, code: string) => sha256(`${config.otpPepper}:signup:${phone}:${code}`);

export async function getSubscription(tx: Tx, storeId: string): Promise<SubscriptionInfo | null> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.storeId, storeId));
  if (!row) return null;
  const until = row.paidUntil && row.paidUntil > row.trialEndsAt ? row.paidUntil : row.trialEndsAt;
  return { plan: row.plan, accessUntil: until.toISOString(), onTrial: row.paidUntil === null };
}

/**
 * After the grace period a store can't change anything until it renews. Sales already made on a
 * till still upload, sign-in still works, and everything stays readable, so no data is held hostage.
 */
export const requireActiveSubscription: MiddlewareHandler<Env> = async (c, next) => {
  const path = c.req.path;
  const exempt = path.startsWith("/v1/auth/") || path.startsWith("/v1/sync/") || path.startsWith("/v1/billing");
  if (c.req.method === "GET" || exempt) return next();
  const store = c.get("store");
  const sub = await withStore(store.id, (tx) => getSubscription(tx, store.id));
  if (!sub || subscriptionState(sub).status === "expired") return c.json({ error: "subscription_expired" }, 402);
  await next();
};

const platformOnly: MiddlewareHandler<Env> = async (c, next) => {
  const key = c.req.header("x-platform-key") ?? "";
  if (!safeEqual(sha256(key), sha256(config.platformKey))) return c.json({ error: "unauthorized" }, 401);
  await next();
};

export function registerPublic(app: Hono<Env>) {
  app.get(
    "/v1/public/subdomain",
    guarded(async (c) => {
      const name = subdomainSchema.safeParse((c.req.query("name") ?? "").toLowerCase());
      if (!name.success) return c.json({ available: false, reason: name.error.issues[0]?.message });
      const [row] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, name.data));
      return c.json(row ? { available: false, reason: "subdomain_taken" } : { available: true });
    }),
  );

  app.post(
    "/v1/public/signup/request-code",
    guarded(async (c) => {
      const { phone } = await parse(c, z.object({ phone: phoneSchema }));
      const code = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ lastSentAt: signupCodes.lastSentAt }).from(signupCodes).where(eq(signupCodes.phone, phone));
        if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
        const value = newCode();
        const row = { codeHash: signupHash(phone, value), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, lastSentAt: new Date() };
        await tx.insert(signupCodes).values({ phone, ...row }).onConflictDoUpdate({ target: signupCodes.phone, set: row });
        return value;
      });
      if (code) await sendLoginCode(phone, code);
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/public/signup",
    guarded(async (c) => {
      const input = await parse(c, signupSchema);
      const [taken] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, input.subdomain));
      if (taken) throw new ApiError("subdomain_taken", 409);

      // Counted in its own step, so wrong guesses still count when the signup itself is refused.
      const [row] = await db
        .update(signupCodes)
        .set({ attempts: sql`${signupCodes.attempts} + 1` })
        .where(and(eq(signupCodes.phone, input.phone), sql`${signupCodes.expiresAt} > now()`, sql`${signupCodes.attempts} < ${MAX_ATTEMPTS}`))
        .returning({ codeHash: signupCodes.codeHash });
      if (!row || !safeEqual(row.codeHash, signupHash(input.phone, input.code))) throw new ApiError("invalid_code", 401);

      const storeId = randomUUID();
      const pinHash = await hashPin(input.pin);
      try {
        await withStore(storeId, async (tx) => {
          await tx.insert(stores).values({ id: storeId, subdomain: input.subdomain, name: input.storeName });
          await tx.insert(users).values({ storeId, name: input.ownerName, phone: input.phone, role: "owner", pinHash });
          await tx.insert(subscriptions).values({ storeId, plan: TRIAL_PLAN, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) });
          await tx.delete(signupCodes).where(eq(signupCodes.phone, input.phone));
        });
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError("subdomain_taken", 409);
        throw e;
      }
      return c.json({ subdomain: input.subdomain, baseDomain: config.baseDomain }, 201);
    }),
  );
}

export async function getSettings(tx: Tx, storeId: string): Promise<StoreSettings> {
  const [row] = await tx.select().from(storeSettings).where(eq(storeSettings.storeId, storeId));
  if (!row) return DEFAULT_SETTINGS;
  const { storeId: _id, ...settings } = row;
  return settings;
}

export function registerBilling(app: Hono<Env>) {
  const owners = [requireDevice, requireSession, requireRole("owner")] as const;

  app.put(
    "/v1/settings",
    ...owners,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, storeSettingsSchema);
      await withStore(store.id, (tx) =>
        tx.insert(storeSettings).values({ storeId: store.id, ...input }).onConflictDoUpdate({ target: storeSettings.storeId, set: input }),
      );
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/billing",
    ...owners,
    guarded(async (c) => {
      const store = c.get("store");
      const data = await withStore(store.id, async (tx): Promise<BillingResponse> => {
        const payments = await tx
          .select({
            id: subscriptionPayments.id, plan: subscriptionPayments.plan, months: subscriptionPayments.months, amountPoisha: subscriptionPayments.amountPoisha,
            method: subscriptionPayments.method, ref: subscriptionPayments.ref, status: subscriptionPayments.status, createdAt: subscriptionPayments.createdAt,
          })
          .from(subscriptionPayments)
          .where(eq(subscriptionPayments.storeId, store.id))
          .orderBy(desc(subscriptionPayments.createdAt))
          .limit(50);
        return {
          subscription: await getSubscription(tx, store.id),
          payTo: config.billingPayTo,
          payments: payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
        };
      });
      return c.json(data);
    }),
  );

  app.post(
    "/v1/billing/payments",
    ...owners,
    guarded(async (c) => {
      const store = c.get("store");
      if (!config.billingPayTo) throw new ApiError("billing_unavailable", 503);
      const input = await parse(c, billingPaymentSchema);
      const plan = planById(input.plan);
      if (!plan) throw new ApiError("invalid");
      try {
        await withStore(store.id, (tx) =>
          tx
            .insert(subscriptionPayments)
            .values({
              storeId: store.id,
              id: input.id,
              plan: plan.id,
              months: input.months,
              // Worked out here, so a device can't name its own price.
              amountPoisha: plan.monthlyPoisha * input.months,
              method: input.method,
              ref: input.ref,
              createdBy: c.get("user").id,
            })
            .onConflictDoNothing({ target: [subscriptionPayments.storeId, subscriptionPayments.id] }),
        );
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError("duplicate_trx", 409);
        throw e;
      }
      return c.json({ ok: true }, 201);
    }),
  );
}

export function registerPlatform(app: Hono<Env>) {
  app.use("/v1/platform/*", platformOnly);

  app.get(
    "/v1/platform/stores",
    guarded(async (c) => {
      const rows = await platformDb
        .select({
          id: stores.id, name: stores.name, subdomain: stores.subdomain, createdAt: stores.createdAt, plan: subscriptions.plan,
          trialEndsAt: subscriptions.trialEndsAt, paidUntil: subscriptions.paidUntil, owner: users.name, phone: users.phone,
        })
        .from(stores)
        .leftJoin(subscriptions, eq(subscriptions.storeId, stores.id))
        .leftJoin(users, and(eq(users.storeId, stores.id), eq(users.role, "owner")))
        .orderBy(desc(stores.createdAt))
        .limit(500);
      const list = rows.map((r): PlatformStore => {
        const paidUntil = r.paidUntil;
        const until = paidUntil && r.trialEndsAt && paidUntil > r.trialEndsAt ? paidUntil : r.trialEndsAt;
        return {
          id: r.id, name: r.name, subdomain: r.subdomain, plan: r.plan ?? "—", owner: r.owner, phone: r.phone,
          accessUntil: until ? until.toISOString() : null,
          status: until ? subscriptionState({ plan: r.plan ?? "", accessUntil: until.toISOString(), onTrial: paidUntil === null }).status : "expired",
        };
      });
      return c.json({ stores: list });
    }),
  );

  app.get(
    "/v1/platform/payments",
    guarded(async (c) => {
      const rows = await platformDb
        .select({
          id: subscriptionPayments.id, storeId: subscriptionPayments.storeId, storeName: stores.name, subdomain: stores.subdomain, plan: subscriptionPayments.plan,
          months: subscriptionPayments.months, amountPoisha: subscriptionPayments.amountPoisha, method: subscriptionPayments.method, ref: subscriptionPayments.ref,
          status: subscriptionPayments.status, createdAt: subscriptionPayments.createdAt,
        })
        .from(subscriptionPayments)
        .innerJoin(stores, eq(stores.id, subscriptionPayments.storeId))
        .orderBy(desc(subscriptionPayments.createdAt))
        .limit(200);
      return c.json<{ payments: PlatformPayment[] }>({ payments: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
    }),
  );

  const ids = z.object({ storeId: z.string().uuid(), id: z.string().uuid() });
  const paymentKey = (c: { req: { param: (k: string) => string | undefined } }) => {
    const parsed = ids.safeParse({ storeId: c.req.param("storeId"), id: c.req.param("id") });
    if (!parsed.success) throw new ApiError("not_found", 404);
    return parsed.data;
  };
  const stillPending = (storeId: string, id: string) =>
    and(eq(subscriptionPayments.storeId, storeId), eq(subscriptionPayments.id, id), eq(subscriptionPayments.status, "pending"));

  app.post(
    "/v1/platform/payments/:storeId/:id/approve",
    guarded(async (c) => {
      const { storeId, id } = paymentKey(c);
      await platformDb.transaction(async (tx) => {
        // Only one approval can move a payment out of "pending", so time is added once.
        const [p] = await tx
          .update(subscriptionPayments)
          .set({ status: "approved", decidedAt: new Date() })
          .where(stillPending(storeId, id))
          .returning({ plan: subscriptionPayments.plan, months: subscriptionPayments.months });
        if (!p) throw new ApiError("not_pending", 409);
        // Paying early extends from the current end date, so no paid days are lost.
        await tx
          .update(subscriptions)
          .set({
            plan: p.plan,
            paidUntil: sql`greatest(now(), ${subscriptions.trialEndsAt}, coalesce(${subscriptions.paidUntil}, 'epoch'::timestamptz)) + make_interval(months => ${p.months}::int)`,
          })
          .where(eq(subscriptions.storeId, storeId));
      });
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/platform/payments/:storeId/:id/reject",
    guarded(async (c) => {
      const { storeId, id } = paymentKey(c);
      const rows = await platformDb
        .update(subscriptionPayments)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(stillPending(storeId, id))
        .returning({ id: subscriptionPayments.id });
      if (!rows.length) throw new ApiError("not_pending", 409);
      return c.json({ ok: true });
    }),
  );
}
