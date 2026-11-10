// A person's own account, all by email: reset a forgotten PIN with an emailed code, change your own
// PIN, and change your email (confirmed by a code sent to the new address). Owners never need to call
// support to get back into their store.
import { emailSchema, pinSchema } from "@lalcha/domain";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { requireDevice, staffOnly } from "./auth.ts";
import { config } from "./config.ts";
import { audit, pgCode, withStore, type Env, type Tx } from "./db.ts";
import { ApiError, guarded, parse } from "./http.ts";
import { sendCode, sendMail } from "./mail.ts";
import { loginCodes, sessions, users } from "./schema.ts";
import { hashPin, newCode, safeEqual, sha256, verifyPin } from "./secrets.ts";

const CODE_TTL_MS = 10 * 60_000;
const CODE_RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Codes share the device-connection table, kept apart by a prefix on the key, so a code sent to
 * connect a device can never reset a PIN, and the other way round.
 */
export const pinResetKey = (email: string) => `pinreset:${email}`;
const emailChangeKey = (userId: string, email: string) => `emailchange:${userId}:${email}`;
export const accountCodeHash = (storeId: string, key: string, code: string) => sha256(`${config.otpPepper}:${storeId}:${key}:${code}`);

/** Stores a fresh code for this key, unless one went out in the last minute. Returns it to be sent. */
export async function issueCode(tx: Tx, storeId: string, key: string, ttlMs = CODE_TTL_MS) {
  const [existing] = await tx.select({ lastSentAt: loginCodes.lastSentAt }).from(loginCodes).where(and(eq(loginCodes.storeId, storeId), eq(loginCodes.contact, key)));
  if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
  const value = newCode();
  const row = { codeHash: accountCodeHash(storeId, key, value), expiresAt: new Date(Date.now() + ttlMs), attempts: 0, lastSentAt: new Date() };
  await tx.insert(loginCodes).values({ storeId, contact: key, ...row }).onConflictDoUpdate({ target: [loginCodes.storeId, loginCodes.contact], set: row });
  return value;
}

/** Uses up a code. Each guess counts first, so five wrong tries end it. */
async function useCode(tx: Tx, storeId: string, key: string, code: string) {
  const [row] = await tx
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.storeId, storeId), eq(loginCodes.contact, key), gt(loginCodes.expiresAt, new Date()), sql`${loginCodes.attempts} < ${MAX_ATTEMPTS}`))
    .returning({ codeHash: loginCodes.codeHash });
  if (!row || !safeEqual(row.codeHash, accountCodeHash(storeId, key, code))) throw new ApiError("invalid_code", 401);
  await tx.delete(loginCodes).where(and(eq(loginCodes.storeId, storeId), eq(loginCodes.contact, key)));
}

/** A new PIN ends every session the person had, so a lost or shared device is signed out too. */
async function setPin(tx: Tx, storeId: string, userId: string, pin: string, keepSession?: string) {
  await tx.update(users).set({ pinHash: await hashPin(pin), pinFailed: 0, pinLockedUntil: null }).where(and(eq(users.storeId, storeId), eq(users.id, userId)));
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.storeId, storeId), eq(sessions.userId, userId), isNull(sessions.revokedAt), keepSession ? ne(sessions.tokenHash, sha256(keepSession)) : undefined));
}

const pinChangedMail = (storeName: string) => ({
  subject: `${storeName}: আপনার পিন বদলানো হয়েছে · Your PIN was changed`,
  text: `${storeName}\n\nআপনার Lalcha POS পিন এইমাত্র বদলানো হয়েছে। আপনি না বদলে থাকলে এখনই দোকানের মালিক বা support@${config.mailDomain}-এ জানান।\n\nYour Lalcha POS PIN was just changed. If this wasn't you, tell the store owner or write to support@${config.mailDomain} now.`,
});

export function registerAccount(app: Hono<Env>) {
  // Forgot PIN: asked from a connected till, sent to the person's own email. Same reply whether or not the email belongs to anyone.
  app.post(
    "/v1/auth/pin-reset/request",
    requireDevice,
    guarded(async (c) => {
      const store = c.get("store");
      const { email } = await parse(c, z.object({ email: emailSchema }));
      const code = await withStore(store.id, async (tx) => {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.storeId, store.id), eq(users.email, email), inArray(users.role, ["owner", "manager"]), isNull(users.disabledAt)));
        return user ? issueCode(tx, store.id, pinResetKey(email)) : null;
      });
      if (code) await sendCode(email, code, `${store.name}: পিন বদলানোর কোড`);
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/auth/pin-reset/confirm",
    requireDevice,
    guarded(async (c) => {
      const store = c.get("store");
      const input = await parse(c, z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, "invalid_code"), pin: pinSchema }));
      const user = await withStore(store.id, async (tx) => {
        await useCode(tx, store.id, pinResetKey(input.email), input.code);
        const [found] = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.storeId, store.id), eq(users.email, input.email), inArray(users.role, ["owner", "manager"]), isNull(users.disabledAt)));
        if (!found) throw new ApiError("invalid_code", 401);
        await setPin(tx, store.id, found.id, input.pin);
        await audit(tx, store.id, found.id, "pin_reset_by_email", found.id);
        return found;
      });
      await sendMail({ to: input.email, ...pinChangedMail(store.name) }).catch(() => undefined);
      return c.json({ ok: true, userId: user.id });
    }),
  );

  // Changing your own PIN needs the current one, so a till left signed in can't be taken over.
  app.post(
    "/v1/auth/me/pin",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const me = c.get("user");
      const input = await parse(c, z.object({ currentPin: z.string().regex(/^\d{4,6}$/, "wrong_pin"), pin: pinSchema }));
      const email = await withStore(store.id, async (tx) => {
        const [row] = await tx.select({ pinHash: users.pinHash, email: users.email }).from(users).where(and(eq(users.storeId, store.id), eq(users.id, me.id)));
        if (!row || !(await verifyPin(input.currentPin, row.pinHash))) throw new ApiError("wrong_pin", 401);
        await setPin(tx, store.id, me.id, input.pin, c.req.header("x-session"));
        await audit(tx, store.id, me.id, "pin_change", me.id);
        return row.email;
      });
      if (email) await sendMail({ to: email, ...pinChangedMail(store.name) }).catch(() => undefined);
      return c.json({ ok: true });
    }),
  );

  app.get(
    "/v1/auth/me",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const [row] = await withStore(store.id, (tx) => tx.select({ name: users.name, email: users.email, phone: users.phone, role: users.role }).from(users).where(and(eq(users.storeId, store.id), eq(users.id, c.get("user").id))));
      return c.json(row);
    }),
  );

  // A new email is only saved once a code sent to it comes back, so a typo can't lock anyone out.
  app.post(
    "/v1/auth/me/email/request",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const me = c.get("user");
      if (me.role === "cashier") throw new ApiError("forbidden", 403);
      const input = await parse(c, z.object({ email: emailSchema, currentPin: z.string().regex(/^\d{4,6}$/, "wrong_pin") }));
      const code = await withStore(store.id, async (tx) => {
        const [row] = await tx.select({ pinHash: users.pinHash }).from(users).where(and(eq(users.storeId, store.id), eq(users.id, me.id)));
        if (!row || !(await verifyPin(input.currentPin, row.pinHash))) throw new ApiError("wrong_pin", 401);
        const [taken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.storeId, store.id), eq(users.email, input.email), ne(users.id, me.id)));
        if (taken) throw new ApiError("duplicate_email", 409);
        return issueCode(tx, store.id, emailChangeKey(me.id, input.email));
      });
      if (code) await sendCode(input.email, code, `${store.name}: নতুন ইমেইল যাচাইয়ের কোড`);
      return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
    }),
  );

  app.post(
    "/v1/auth/me/email/confirm",
    ...staffOnly,
    guarded(async (c) => {
      const store = c.get("store");
      const me = c.get("user");
      const input = await parse(c, z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, "invalid_code") }));
      const old = await withStore(store.id, async (tx) => {
        await useCode(tx, store.id, emailChangeKey(me.id, input.email), input.code);
        const [row] = await tx.select({ email: users.email }).from(users).where(and(eq(users.storeId, store.id), eq(users.id, me.id)));
        await tx.update(users).set({ email: input.email }).where(and(eq(users.storeId, store.id), eq(users.id, me.id)));
        await audit(tx, store.id, me.id, "email_change", me.id, { from: row?.email ?? null, to: input.email });
        return row?.email ?? null;
      }).catch((e) => {
        if (pgCode(e) === "23505") throw new ApiError("duplicate_email", 409);
        throw e;
      });
      // The old address hears about it too, in case it wasn't the owner who changed it.
      if (old && old !== input.email) {
        await sendMail({
          to: old,
          subject: `${store.name}: ইমেইল বদলানো হয়েছে · Email changed`,
          text: `${store.name}\n\nআপনার Lalcha POS অ্যাকাউন্টের ইমেইল ${input.email}-এ বদলানো হয়েছে। আপনি না করে থাকলে এখনই support@${config.mailDomain}-এ জানান।\n\nThe email on your Lalcha POS account was changed to ${input.email}. If this wasn't you, write to support@${config.mailDomain} now.`,
        }).catch(() => undefined);
      }
      return c.json({ ok: true });
    }),
  );
}
