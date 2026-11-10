import {
  billingPaymentSchema,
  manualSubscriptionSchema,
  BUSINESS_PROFILES,
  DEFAULT_SETTINGS,
  storeSettingsSchema,
  type StoreSettings,
  emailSchema,
  pinSchema,
  type PlatformLog,
  buyablePlans,
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
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDevice, requireRole, requireSession } from "./auth.ts";
import { sendCode } from "./mail.ts";
import { issueCode, pinResetKey } from "./account.ts";
import { HANDOFF_TTL_MS, handoffHash, handoffKey, handoffLink } from "./auth.ts";
import { createHmac } from "node:crypto";
import { config } from "./config.ts";
import { audit, db, pgCode, platformDb, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, PAGE_SIZE, pageOf, parse } from "./http.ts";
import { branches, loginCodes, platformAudit, platformCodes, platformSessions, sessions, signupCodes, storeSettings, stores, subscriptionPayments, subscriptions, users } from "./schema.ts";
import { hashPin, newCode, newToken, safeEqual, sha256 } from "./secrets.ts";

const CODE_TTL_MS = 5 * 60_000;
const CODE_RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;

const signupHash = (email: string, code: string) => sha256(`${config.otpPepper}:signup:${email}:${code}`);

export async function getSubscription(tx: Tx, storeId: string): Promise<SubscriptionInfo | null> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.storeId, storeId));
  if (!row) return null;
  const until = row.paidUntil && row.paidUntil > row.trialEndsAt ? row.paidUntil : row.trialEndsAt;
  const [store] = await tx.select({ suspendedAt: stores.suspendedAt }).from(stores).where(eq(stores.id, storeId));
  return { plan: row.plan, accessUntil: until.toISOString(), onTrial: row.paidUntil === null, suspended: Boolean(store?.suspendedAt) };
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

const PLATFORM_SESSION_MS = 8 * 60 * 60_000;
const platformCodeHash = (email: string, code: string) => sha256(`${config.otpPepper}:platform:${email}:${code}`);
const hostOf = (c: { req: { header: (k: string) => string | undefined } }) => (c.req.header("host") ?? "").split(":")[0].toLowerCase();

/**
 * The superadmin API answers only on its own address. Anywhere else it looks like it doesn't exist,
 * so a store's address can't be used to probe it. In production, put Cloudflare Access in front too.
 */
const adminHostOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (hostOf(c) !== config.adminHost) return c.json({ error: "not_found" }, 404);
  await next();
};

const platformSession: MiddlewareHandler<Env> = async (c, next) => {
  const token = c.req.header("x-platform-session") ?? "";
  const [row] = token
    ? await platformDb
        .select({ email: platformSessions.email })
        .from(platformSessions)
        .where(and(eq(platformSessions.tokenHash, sha256(token)), isNull(platformSessions.revokedAt), gt(platformSessions.expiresAt, new Date())))
    : [];
  // Someone removed from PLATFORM_ADMIN_EMAILS loses access at once, even with a session still open.
  if (!row || !config.platformAdmins.includes(row.email)) return c.json({ error: "unauthorized" }, 401);
  c.set("platformAdmin", row.email);
  await next();
};

/** Turns a shop name into an address: "Rahim's Store & Co." → "rahims-store-co". Non-Latin letters are dropped. */
export function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");
}

/** Up to four free addresses close to what they typed and their shop name, checked against the database in one query. */
export async function suggestSubdomains(typed: string, storeName: string) {
  const bases = [...new Set([slugify(typed), slugify(storeName), slugify(storeName).replace(/-/g, "")].filter((b) => b.length >= 2))];
  if (!bases.length) return [];
  const candidates: string[] = [];
  for (const b of bases) {
    const short = b.slice(0, 24).replace(/-+$/, "");
    candidates.push(b, `${short}store`, `${short}-shop`, `${short}bd`, `${short}shop`, `${short}-bd`, `${short}24`, `my${short}`, `${short}${String(10 + Math.floor(Math.random() * 90))}`);
  }
  const valid = [...new Set(candidates)].filter((x) => subdomainSchema.safeParse(x).success);
  if (!valid.length) return [];
  const taken = new Set((await db.select({ subdomain: stores.subdomain }).from(stores).where(inArray(stores.subdomain, valid))).map((r) => r.subdomain));
  return valid.filter((x) => !taken.has(x)).slice(0, 4);
}

export function registerPublic(app: Hono<Env>) {
  app.get(
    "/v1/public/subdomain",
    guarded(async (c) => {
      const raw = (c.req.query("name") ?? "").toLowerCase().slice(0, 40);
      const storeName = (c.req.query("store") ?? "").slice(0, 100);
      const name = subdomainSchema.safeParse(raw);
      if (name.success) {
        const [row] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, name.data));
        if (!row) return c.json({ available: true });
      }
      // Taken, reserved or malformed: offer free ones to tap instead of leaving them to guess.
      return c.json({ available: false, reason: name.success ? "subdomain_taken" : name.error.issues[0]?.message, suggestions: await suggestSubdomains(raw, storeName) });
    }),
  );

  app.post(
    "/v1/public/signup/request-code",
    guarded(async (c) => {
      const { email } = await parse(c, z.object({ email: emailSchema }));
      const code = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ lastSentAt: signupCodes.lastSentAt }).from(signupCodes).where(eq(signupCodes.contact, email));
        if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
        const value = newCode();
        const row = { codeHash: signupHash(email, value), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, lastSentAt: new Date() };
        await tx.insert(signupCodes).values({ contact: email, ...row }).onConflictDoUpdate({ target: signupCodes.contact, set: row });
        return value;
      });
      if (code) await sendCode(email, code, "নতুন দোকান খোলার কোড");
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/public/signup",
    guarded(async (c) => {
      const input = await parse(c, signupSchema);
      const [taken] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, input.subdomain));
      if (taken) return c.json({ error: "subdomain_taken", suggestions: await suggestSubdomains(input.subdomain, input.storeName) }, 409);

      // Counted in its own step, so wrong guesses still count when the signup itself is refused.
      const [row] = await db
        .update(signupCodes)
        .set({ attempts: sql`${signupCodes.attempts} + 1` })
        .where(and(eq(signupCodes.contact, input.email), sql`${signupCodes.expiresAt} > now()`, sql`${signupCodes.attempts} < ${MAX_ATTEMPTS}`))
        .returning({ codeHash: signupCodes.codeHash });
      if (!row || !safeEqual(row.codeHash, signupHash(input.email, input.code))) throw new ApiError("invalid_code", 401);

      const storeId = randomUUID();
      const pinHash = await hashPin(input.pin);
      const handoff = newToken();
      const ownerId = randomUUID();
      try {
        await withStore(storeId, async (tx) => {
          await tx.insert(stores).values({ id: storeId, subdomain: input.subdomain, name: input.storeName });
          await tx.insert(branches).values({ storeId, name: "Main" });
          await tx.insert(users).values({ storeId, id: ownerId, name: input.ownerName, email: input.email, phone: input.phone, role: "owner", pinHash });
          await tx.insert(subscriptions).values({ storeId, plan: TRIAL_PLAN, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) });
          if (input.businessType) {
            await tx.insert(storeSettings).values({ storeId, businessType: input.businessType, features: BUSINESS_PROFILES[input.businessType].features, onboarded: false });
          }
          await tx.delete(signupCodes).where(eq(signupCodes.contact, input.email));
          await tx.insert(loginCodes).values({ storeId, contact: handoffKey(ownerId), codeHash: handoffHash(storeId, handoff), expiresAt: new Date(Date.now() + HANDOFF_TTL_MS), attempts: 0, lastSentAt: new Date() });
        });
      } catch (e) {
        // Someone took it in the moment between the check and this press: offer free ones right away.
        if (pgCode(e) === "23505") return c.json({ error: "subdomain_taken", suggestions: await suggestSubdomains(input.subdomain, input.storeName) }, 409);
        throw e;
      }
      return c.json({ subdomain: input.subdomain, baseDomain: config.baseDomain, handoff: handoffLink(ownerId, handoff) }, 201);
    }),
  );
}

/* ---------- One sign-in on lalcha.com for every store a person runs ---------- */

const LOGIN_TICKET_MS = 15 * 60_000;
const loginKey = (email: string) => `login:${email}`;
/** After the email code checks out: a short-lived, signed pass that lists and opens that person's stores. */
const signTicket = (email: string, expires: number) => {
  const body = Buffer.from(JSON.stringify({ email, expires })).toString("base64url");
  return `${body}.${createHmac("sha256", config.otpPepper).update(`login-ticket:${body}`).digest("base64url")}`;
};
function readTicket(ticket: string) {
  const [body, mac] = ticket.split(".");
  if (!body || !mac || !safeEqual(mac, createHmac("sha256", config.otpPepper).update(`login-ticket:${body}`).digest("base64url"))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as { email: string; expires: number };
  return data.expires > Date.now() ? data.email : null;
}

/** Stores where this email belongs to an active owner or manager. Read across stores, so it uses the platform role. */
async function storesOf(email: string) {
  return (await platformDb.execute(sql`
    select s.id as "storeId", s.subdomain, s.name, u.id as "userId", u.role, ss.logo_url as "logoUrl", s.suspended_at is not null as suspended
    from users u join stores s on s.id = u.store_id left join store_settings ss on ss.store_id = s.id
    where u.email = ${email} and u.role in ('owner', 'manager') and u.disabled_at is null
    order by (u.role = 'owner') desc, s.name`)) as unknown as { storeId: string; subdomain: string; name: string; userId: string; role: string; logoUrl: string | null; suspended: boolean }[];
}

export function registerLogin(app: Hono<Env>) {
  app.post(
    "/v1/public/login/request-code",
    guarded(async (c) => {
      const { email } = await parse(c, z.object({ email: emailSchema }));
      const has = (await storesOf(email)).length > 0;
      const code = has
        ? await db.transaction(async (tx) => {
            const [existing] = await tx.select({ lastSentAt: signupCodes.lastSentAt }).from(signupCodes).where(eq(signupCodes.contact, loginKey(email)));
            if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
            const value = newCode();
            const row = { codeHash: signupHash(loginKey(email), value), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, lastSentAt: new Date() };
            await tx.insert(signupCodes).values({ contact: loginKey(email), ...row }).onConflictDoUpdate({ target: signupCodes.contact, set: row });
            return value;
          })
        : null;
      // Same reply for an email with no store, so nobody can test who has an account.
      if (code) await sendCode(email, code, "Lalcha POS: সাইন-ইন কোড");
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/public/login/verify",
    guarded(async (c) => {
      const input = await parse(c, z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, "invalid_code") }));
      const [row] = await db
        .update(signupCodes)
        .set({ attempts: sql`${signupCodes.attempts} + 1` })
        .where(and(eq(signupCodes.contact, loginKey(input.email)), sql`${signupCodes.expiresAt} > now()`, sql`${signupCodes.attempts} < ${MAX_ATTEMPTS}`))
        .returning({ codeHash: signupCodes.codeHash });
      if (!row || !safeEqual(row.codeHash, signupHash(loginKey(input.email), input.code))) throw new ApiError("invalid_code", 401);
      await db.delete(signupCodes).where(eq(signupCodes.contact, loginKey(input.email)));
      const list = await storesOf(input.email);
      return c.json({
        ticket: signTicket(input.email, Date.now() + LOGIN_TICKET_MS),
        baseDomain: config.baseDomain,
        stores: list.map(({ storeId, subdomain, name, role, logoUrl, suspended }) => ({ storeId, subdomain, name, role, logoUrl, suspended })),
      });
    }),
  );

  // Opening a store from the list connects this browser to it, like signup does: straight to the PIN screen.
  app.post(
    "/v1/public/login/open",
    guarded(async (c) => {
      const input = await parse(c, z.object({ ticket: z.string().max(2000), storeId: z.string().uuid() }));
      let email: string | null = null;
      try {
        email = readTicket(input.ticket);
      } catch {
        email = null;
      }
      if (!email) throw new ApiError("login_expired", 401);
      const entry = (await storesOf(email)).find((s) => s.storeId === input.storeId);
      if (!entry) throw new ApiError("not_found", 404);
      const secret = newToken();
      await platformDb
        .insert(loginCodes)
        .values({ storeId: entry.storeId, contact: handoffKey(entry.userId), codeHash: handoffHash(entry.storeId, secret), expiresAt: new Date(Date.now() + HANDOFF_TTL_MS), attempts: 0, lastSentAt: new Date() })
        .onConflictDoUpdate({ target: [loginCodes.storeId, loginCodes.contact], set: { codeHash: handoffHash(entry.storeId, secret), expiresAt: new Date(Date.now() + HANDOFF_TTL_MS), attempts: 0, lastSentAt: new Date() } });
      return c.json({ subdomain: entry.subdomain, baseDomain: config.baseDomain, handoff: handoffLink(entry.userId, secret) });
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
      // The logo only changes through its own upload, so saving settings can never wipe or forge it.
      const { logoUrl: _ignored, ...input } = await parse(c, storeSettingsSchema);
      await withStore(store.id, async (tx) => {
        await tx.insert(storeSettings).values({ storeId: store.id, ...input }).onConflictDoUpdate({ target: storeSettings.storeId, set: input });
        await audit(tx, store.id, c.get("user").id, "settings_update", null, { vatEnabled: input.vatEnabled, vatRateBp: input.vatRateBp, vatInclusive: input.vatInclusive });
      });
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
      const [current] = await withStore(store.id, (tx) => tx.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.storeId, store.id)));
      const plan = buyablePlans(current?.plan).find((p) => p.id === input.plan);
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
  app.use("/v1/platform/*", adminHostOnly);

  app.post(
    "/v1/platform/auth/request-code",
    guarded(async (c) => {
      const { email } = await parse(c, z.object({ email: emailSchema }));
      const allowed = config.platformAdmins.includes(email);
      const code = allowed
        ? await platformDb.transaction(async (tx) => {
            const [existing] = await tx.select({ lastSentAt: platformCodes.lastSentAt }).from(platformCodes).where(eq(platformCodes.email, email));
            if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
            const value = newCode();
            const row = { codeHash: platformCodeHash(email, value), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, lastSentAt: new Date() };
            await tx.insert(platformCodes).values({ email, ...row }).onConflictDoUpdate({ target: platformCodes.email, set: row });
            return value;
          })
        : null;
      // Same reply either way, so nobody can find out which emails are admins.
      if (code) await sendCode(email, code, "Superadmin sign-in");
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/platform/auth/verify",
    guarded(async (c) => {
      const { email, code } = await parse(c, z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }));
      const [row] = await platformDb
        .update(platformCodes)
        .set({ attempts: sql`${platformCodes.attempts} + 1` })
        .where(and(eq(platformCodes.email, email), sql`${platformCodes.expiresAt} > now()`, sql`${platformCodes.attempts} < ${MAX_ATTEMPTS}`))
        .returning({ codeHash: platformCodes.codeHash });
      if (!row || !config.platformAdmins.includes(email) || !safeEqual(row.codeHash, platformCodeHash(email, code))) throw new ApiError("invalid_code", 401);
      const token = newToken();
      const expiresAt = new Date(Date.now() + PLATFORM_SESSION_MS);
      await platformDb.transaction(async (tx) => {
        await tx.delete(platformCodes).where(eq(platformCodes.email, email));
        await tx.insert(platformSessions).values({ tokenHash: sha256(token), email, expiresAt });
        await tx.insert(platformAudit).values({ actor: email, action: "sign_in" });
      });
      return c.json({ token, expiresAt: expiresAt.toISOString(), email });
    }),
  );

  // Everything below needs a signed-in superadmin.
  app.use("/v1/platform/*", async (c, next) => (c.req.path.startsWith("/v1/platform/auth/") ? next() : platformSession(c, next)));

  app.post(
    "/v1/platform/sign-out",
    guarded(async (c) => {
      await platformDb.update(platformSessions).set({ revokedAt: new Date() }).where(eq(platformSessions.tokenHash, sha256(c.req.header("x-platform-session") ?? "")));
      return c.json({ ok: true });
    }),
  );

  const log = (c: Context<Env>, tx: typeof platformDb | Parameters<Parameters<typeof platformDb.transaction>[0]>[0], storeId: string | null, action: string, detail?: string) =>
    tx.insert(platformAudit).values({ storeId, actor: c.get("platformAdmin"), action, detail: detail ?? null });
  const storeParam = (c: { req: { param: (k: string) => string | undefined } }) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new ApiError("not_found", 404);
    return id.data;
  };

  app.get(
    "/v1/platform/stores",
    guarded(async (c) => {
      const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60);
      const page = pageOf(c);
      const match = q ? sql`and (strpos(lower(st.name), ${q}) > 0 or strpos(lower(st.subdomain), ${q}) > 0 or strpos(coalesce(o.phone, ''), ${q}) > 0 or strpos(coalesce(o.email, ''), ${q}) > 0)` : sql``;
      const rows = (await platformDb.execute(sql`
        select st.id, st.name, st.subdomain, st.created_at as "createdAt", st.suspended_at as "suspendedAt", st.support_note as note,
               sub.plan, sub.trial_ends_at as "trialEndsAt", sub.paid_until as "paidUntil", o.name as owner, o.phone, o.email,
               (select count(*)::int from devices d where d.store_id = st.id and d.revoked_at is null) as devices,
               (select count(*)::int from users u where u.store_id = st.id and u.disabled_at is null) as staff,
               (select count(*)::int from sales s where s.store_id = st.id and s.sold_at > now() - interval '30 days') as "salesLast30",
               (select max(s.sold_at) from sales s where s.store_id = st.id) as "lastSaleAt"
        from stores st
        left join subscriptions sub on sub.store_id = st.id
        left join lateral (select name, phone, email from users u where u.store_id = st.id and u.role = 'owner' limit 1) o on true
        where true ${match}
        order by st.created_at desc limit ${PAGE_SIZE + 1} offset ${page.offset}
      `)) as unknown as Record<string, never>[];
      const list = rows.slice(0, PAGE_SIZE).map((r: Record<string, any>): PlatformStore => {
        const trial = r.trialEndsAt ? new Date(r.trialEndsAt) : null;
        const paid = r.paidUntil ? new Date(r.paidUntil) : null;
        const until = paid && trial && paid > trial ? paid : trial;
        return {
          id: r.id, name: r.name, subdomain: r.subdomain, plan: r.plan ?? "—", owner: r.owner, phone: r.phone, email: r.email, note: r.note, devices: r.devices, staff: r.staff, salesLast30: r.salesLast30,
          createdAt: new Date(r.createdAt).toISOString(),
          lastSaleAt: r.lastSaleAt ? new Date(r.lastSaleAt).toISOString() : null,
          accessUntil: until ? until.toISOString() : null,
          suspended: Boolean(r.suspendedAt),
          status: until ? subscriptionState({ plan: r.plan ?? "", accessUntil: until.toISOString(), onTrial: paid === null, suspended: Boolean(r.suspendedAt) }).status : "expired",
        };
      });
      return c.json({ stores: list, hasMore: rows.length > PAGE_SIZE });
    }),
  );

  app.post(
    "/v1/platform/stores/:id/extend",
    guarded(async (c) => {
      const id = storeParam(c);
      const { days } = await parse(c, z.object({ days: z.number().int().min(1).max(366) }));
      await platformDb.transaction(async (tx) => {
        const rows = await tx
          .update(subscriptions)
          .set({ trialEndsAt: sql`greatest(now(), ${subscriptions.trialEndsAt}) + make_interval(days => ${days}::int)` })
          .where(eq(subscriptions.storeId, id))
          .returning({ id: subscriptions.storeId });
        if (!rows.length) throw new ApiError("not_found", 404);
        await log(c, tx, id, "extend", `${days} days`);
      });
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/platform/stores/:id/plan",
    guarded(async (c) => {
      const id = storeParam(c);
      const { plan } = await parse(c, z.object({ plan: z.string() }));
      if (!planById(plan)) throw new ApiError("invalid");
      await platformDb.transaction(async (tx) => {
        const rows = await tx.update(subscriptions).set({ plan }).where(eq(subscriptions.storeId, id)).returning({ id: subscriptions.storeId });
        if (!rows.length) throw new ApiError("not_found", 404);
        await log(c, tx, id, "plan", plan);
      });
      return c.json({ ok: true });
    }),
  );

  // For payments made outside the app: cash, bank transfer, or a deal agreed by phone.
  app.post(
    "/v1/platform/stores/:id/subscription",
    guarded(async (c) => {
      const id = storeParam(c);
      const input = await parse(c, manualSubscriptionSchema);
      if (!planById(input.plan)) throw new ApiError("invalid");
      const paymentId = randomUUID();
      // The ref must be unique per method, so a blank one gets a readable generated value.
      const ref = input.ref || `MANUAL-${paymentId.slice(0, 8).toUpperCase()}`;
      try {
        await platformDb.transaction(async (tx) => {
          const [owner] = await tx.select({ id: users.id }).from(users).where(and(eq(users.storeId, id), eq(users.role, "owner"))).limit(1);
          if (!owner) throw new ApiError("not_found", 404);
          await tx.insert(subscriptionPayments).values({
            storeId: id, id: paymentId, plan: input.plan, months: input.months, amountPoisha: input.amountPoisha,
            method: input.method, ref, status: "approved", createdBy: owner.id, decidedAt: new Date(),
          });
          const rows = await tx
            .update(subscriptions)
            .set({
              plan: input.plan,
              paidUntil: sql`greatest(now(), ${subscriptions.trialEndsAt}, coalesce(${subscriptions.paidUntil}, 'epoch'::timestamptz)) + make_interval(months => ${input.months}::int)`,
            })
            .where(eq(subscriptions.storeId, id))
            .returning({ id: subscriptions.storeId });
          if (!rows.length) throw new ApiError("not_found", 404);
          await log(c, tx, id, "manual_subscription", `${input.plan} · ${input.months} mo · ${input.method} · ${input.amountPoisha / 100} BDT · ${ref}`);
        });
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError("duplicate_trx", 409);
        throw e;
      }
      return c.json({ ok: true }, 201);
    }),
  );

  app.post(
    "/v1/platform/stores/:id/suspend",
    guarded(async (c) => {
      const id = storeParam(c);
      const { suspended } = await parse(c, z.object({ suspended: z.boolean() }));
      await platformDb.transaction(async (tx) => {
        const rows = await tx.update(stores).set({ suspendedAt: suspended ? new Date() : null }).where(eq(stores.id, id)).returning({ id: stores.id });
        if (!rows.length) throw new ApiError("not_found", 404);
        await log(c, tx, id, suspended ? "suspend" : "unsuspend");
      });
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/v1/platform/stores/:id/note",
    guarded(async (c) => {
      const id = storeParam(c);
      const { note } = await parse(c, z.object({ note: z.string().trim().max(1000) }));
      await platformDb.transaction(async (tx) => {
        await tx.update(stores).set({ supportNote: note || null }).where(eq(stores.id, id));
        await log(c, tx, id, "note");
      });
      return c.json({ ok: true });
    }),
  );

  // For owners who forgot their PIN. The new PIN is shown once and is never stored readable.
  app.post(
    "/v1/platform/stores/:id/reset-owner-pin",
    guarded(async (c) => {
      // You never see or read out an owner's PIN: the owner gets a code by email and sets a new PIN themselves.
      const id = storeParam(c);
      const sent = await platformDb.transaction(async (tx) => {
        const [owner] = await tx
          .select({ email: users.email, store: stores.name })
          .from(users)
          .innerJoin(stores, eq(stores.id, users.storeId))
          .where(and(eq(users.storeId, id), eq(users.role, "owner")));
        if (!owner) throw new ApiError("not_found", 404);
        if (!owner.email) throw new ApiError("owner_has_no_email", 409);
        const code = await issueCode(tx, id, pinResetKey(owner.email), 30 * 60_000);
        await log(c, tx, id, "reset_owner_pin_email");
        return { ...owner, code };
      });
      if (sent.code) await sendCode(sent.email!, sent.code, `${sent.store}: পিন বদলানোর কোড (৩০ মিনিট)`);
      return c.json({ sentTo: sent.email!.replace(/^(.{2}).*(@.*)$/, "$1•••$2"), resent: Boolean(sent.code) });
    }),
  );

  app.get(
    "/v1/platform/log",
    guarded(async (c) => {
      const rows = await platformDb
        .select({ id: platformAudit.id, actor: platformAudit.actor, action: platformAudit.action, detail: platformAudit.detail, at: platformAudit.at, storeName: stores.name })
        .from(platformAudit)
        .leftJoin(stores, eq(stores.id, platformAudit.storeId))
        .orderBy(desc(platformAudit.at))
        .limit(100);
      return c.json<{ log: PlatformLog[] }>({ log: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
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
        await log(c, tx, storeId, "approve_payment", id);
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
      await log(c, platformDb, storeId, "reject_payment", id);
      return c.json({ ok: true });
    }),
  );
}
