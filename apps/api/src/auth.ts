import {
  emailSchema,
  hasContactIfManager,
  phoneSchema,
  planById,
  staffCreateSchema,
  staffUpdateSchema,
  type DeviceRecord,
  type Role,
  type SignInResponse,
  type StaffMember,
  type StaffRecord,
} from "@lalcha/domain";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.ts";
import { mainBranchId } from "./branches.ts";
import { audit, pgCode, withStore, type Env, type Tx } from "./db.ts";
import { isDemoStore } from "./demo.ts";
import { sendCode } from "./mail.ts";
import { devices, loginCodes, sessions, subscriptions, users } from "./schema.ts";
import { hashPin, newCode, newToken, safeEqual, sha256, verifyPin } from "./secrets.ts";

const CODE_TTL_MS = 5 * 60_000;
const CODE_RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 5 * 60_000;
const SESSION_MS = 12 * 60 * 60_000;

const codeHash = (storeId: string, contact: string, code: string) => sha256(`${config.otpPepper}:${storeId}:${contact}:${code}`);

/** Where a code goes: an email address first, or a phone number. */
const contactSchema = z.union([z.object({ email: emailSchema }), z.object({ phone: phoneSchema })]);
const contactOf = (input: { email: string } | { phone: string }) => ("email" in input ? input.email : input.phone);
const userByContact = (input: { email: string } | { phone: string }) => ("email" in input ? eq(users.email, input.email) : eq(users.phone, input.phone));

const bearer = (c: Context<Env>) => c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";

export const requireDevice: MiddlewareHandler<Env> = async (c, next) => {
  const store = c.get("store");
  const token = bearer(c);
  const [device] = token
    ? await withStore(store.id, async (tx) => {
        const rows = await tx
          .select({ id: devices.id, branchId: devices.branchId })
          .from(devices)
          .where(and(eq(devices.storeId, store.id), eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt)));
        if (rows[0]) {
          await tx
            .update(devices)
            .set({ lastSeenAt: new Date() })
            .where(and(eq(devices.storeId, store.id), eq(devices.id, rows[0].id), sql`${devices.lastSeenAt} < now() - interval '5 minutes'`));
        }
        return rows;
      })
    : [];
  if (!device) return c.json({ error: "device_unauthorized" }, 401);
  c.set("device", device);
  await next();
};

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  const store = c.get("store");
  const token = c.req.header("x-session") ?? "";
  const [row] = token
    ? await withStore(store.id, (tx) =>
        tx
          .select({ id: users.id, name: users.name, role: users.role })
          .from(sessions)
          .innerJoin(users, and(eq(users.storeId, sessions.storeId), eq(users.id, sessions.userId)))
          .where(
            and(
              eq(sessions.storeId, store.id),
              eq(sessions.tokenHash, sha256(token)),
              eq(sessions.deviceId, c.get("device").id),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, new Date()),
              isNull(users.disabledAt),
            ),
          ),
      )
    : [];
  if (!row) return c.json({ error: "session_required" }, 401);
  c.set("user", row);
  await next();
};

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (!roles.includes(c.get("user").role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };

export const staffOnly = [requireDevice, requireSession] as const;
export const managers = [requireDevice, requireSession, requireRole("owner", "manager")] as const;

/** Which contact detail another staff member already uses, from the unique index that refused it. */
const duplicateContact = (e: unknown) =>
  pgCode(e) !== "23505" ? null : String((e as { constraint_name?: string }).constraint_name ?? "").includes("email") ? "duplicate_email" : "duplicate_phone";
const uuid = z.string().uuid();


/** Connects a device for this person, within the plan's device limit. Returns its token, or "limit". */
export async function connectDevice(tx: Tx, storeId: string, userId: string, deviceName: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`devices:${storeId}`}, 0))`);
  const [plan] = await tx.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.storeId, storeId));
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(and(eq(devices.storeId, storeId), isNull(devices.revokedAt)));
  if (count >= (planById(plan?.plan ?? "")?.maxDevices ?? 1)) return "limit" as const;
  const token = newToken();
  const deviceId = randomUUID();
  await tx.insert(devices).values({ storeId, id: deviceId, name: deviceName, tokenHash: sha256(token), pairedBy: userId, branchId: await mainBranchId(tx, storeId) });
  await audit(tx, storeId, userId, "device_connect", deviceId, { name: deviceName });
  return token;
}

/**
 * The hand-off from signup: lalcha.com and the store's own address are separate sites to the browser,
 * so signup can't connect the device itself. It leaves a one-time code (5 minutes) that the store page
 * trades for a connected device. Only a hash is stored, so the database never holds a usable code.
 */
export const handoffKey = (userId: string) => `handoff:${userId}`;
export const handoffHash = (storeId: string, token: string) => sha256(`${config.otpPepper}:${storeId}:handoff:${token}`);
export const HANDOFF_TTL_MS = 5 * 60_000;
/** The code in the link is "<person>.<secret>": the person it connects, then the one-time secret. */
export const handoffLink = (userId: string, secret: string) => `${userId}.${secret}`;

export function registerAuth(app: Hono<Env>) {
  app.post("/v1/auth/request-code", async (c) => {
    const store = c.get("store");
    const body = contactSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_email" }, 400);
    const contact = contactOf(body.data);

    const code = await withStore(store.id, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.storeId, store.id), userByContact(body.data), inArray(users.role, ["owner", "manager"]), isNull(users.disabledAt)));
      if (!user) return null;
      const [existing] = await tx
        .select({ lastSentAt: loginCodes.lastSentAt })
        .from(loginCodes)
        .where(and(eq(loginCodes.storeId, store.id), eq(loginCodes.contact, contact)));
      if (existing && Date.now() - existing.lastSentAt.getTime() < CODE_RESEND_MS) return null;
      const value = newCode();
      const row = {
        codeHash: codeHash(store.id, contact, value),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        attempts: 0,
        lastSentAt: new Date(),
      };
      await tx
        .insert(loginCodes)
        .values({ storeId: store.id, contact, ...row })
        .onConflictDoUpdate({ target: [loginCodes.storeId, loginCodes.contact], set: row });
      return value;
    });

    // The reply is the same for unknown addresses, so nobody can test who is registered.
    if (code) await sendCode(contact, code, `${store.name}: নতুন ডিভাইস যুক্ত করার কোড`);
    return c.json(!config.isProduction && code ? { ok: true, devCode: code } : { ok: true });
  });

  app.post("/v1/auth/handoff", async (c) => {
    const store = c.get("store");
    const body = z
      .object({ token: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,128}$/), deviceName: z.string().trim().min(1).max(60) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_code" }, 400);
    const [userId, secret] = body.data.token.split(".");
    const result = await withStore(store.id, async (tx) => {
      const [row] = await tx
        .update(loginCodes)
        .set({ attempts: sql`${loginCodes.attempts} + 1` })
        .where(and(eq(loginCodes.storeId, store.id), eq(loginCodes.contact, handoffKey(userId)), gt(loginCodes.expiresAt, new Date()), sql`${loginCodes.attempts} < ${MAX_ATTEMPTS}`))
        .returning({ codeHash: loginCodes.codeHash });
      if (!row || !safeEqual(row.codeHash, handoffHash(store.id, secret))) return null;
      // Used once: a copied or bookmarked link can't connect a second device.
      await tx.delete(loginCodes).where(and(eq(loginCodes.storeId, store.id), eq(loginCodes.contact, handoffKey(userId))));
      const [person] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.storeId, store.id), eq(users.id, userId), inArray(users.role, ["owner", "manager"]), isNull(users.disabledAt)));
      return person ? connectDevice(tx, store.id, person.id, body.data.deviceName) : null;
    });
    if (result === "limit") return c.json({ error: "device_limit" }, 403);
    return result ? c.json({ deviceToken: result }) : c.json({ error: "invalid_code" }, 401);
  });

  app.post("/v1/auth/verify-code", async (c) => {
    const store = c.get("store");
    const body = z
      .object({ code: z.string().regex(/^\d{6}$/), deviceName: z.string().trim().min(1).max(60) })
      .and(contactSchema)
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_code" }, 400);
    const { code, deviceName } = body.data;
    const contact = contactOf(body.data);

    const deviceToken = await withStore(store.id, async (tx) => {
      // Counts the attempt before checking, so guesses can't slip past the limit by arriving together.
      const [row] = await tx
        .update(loginCodes)
        .set({ attempts: sql`${loginCodes.attempts} + 1` })
        .where(
          and(
            eq(loginCodes.storeId, store.id),
            eq(loginCodes.contact, contact),
            gt(loginCodes.expiresAt, new Date()),
            sql`${loginCodes.attempts} < ${MAX_ATTEMPTS}`,
          ),
        )
        .returning({ codeHash: loginCodes.codeHash });
      if (!row || !safeEqual(row.codeHash, codeHash(store.id, contact, code))) return null;
      await tx.delete(loginCodes).where(and(eq(loginCodes.storeId, store.id), eq(loginCodes.contact, contact)));
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.storeId, store.id), userByContact(body.data), inArray(users.role, ["owner", "manager"]), isNull(users.disabledAt)));
      if (!user) return null;
      return connectDevice(tx, store.id, user.id, deviceName);
    });
    if (deviceToken === "limit") return c.json({ error: "device_limit" }, 403);
    return deviceToken ? c.json({ deviceToken }) : c.json({ error: "invalid_code" }, 401);
  });

  app.get("/v1/auth/staff", requireDevice, async (c) => {
    const store = c.get("store");
    const rows = await withStore(store.id, (tx) =>
      tx
        // pinVersion changes whenever the PIN does, so tills drop the old PIN they keep for offline sign-in.
        .select({ id: users.id, name: users.name, role: users.role, pinVersion: sql<string>`substr(md5(${users.pinHash}), 1, 12)` })
        .from(users)
        .where(and(eq(users.storeId, store.id), isNull(users.disabledAt)))
        .orderBy(users.name),
    );
    return c.json<{ staff: StaffMember[] }>({ staff: rows });
  });

  app.post("/v1/auth/pin", requireDevice, async (c) => {
    const store = c.get("store");
    const body = z.object({ userId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wrong_pin" }, 401);
    const { userId, pin } = body.data;
    const where = and(eq(users.storeId, store.id), eq(users.id, userId), isNull(users.disabledAt));

    const [user] = await withStore(store.id, (tx) =>
      tx.select({ id: users.id, name: users.name, role: users.role, pinHash: users.pinHash, pinLockedUntil: users.pinLockedUntil }).from(users).where(where),
    );
    if (!user) return c.json({ error: "wrong_pin" }, 401);
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) return c.json({ error: "locked" }, 423);

    if (!(await verifyPin(pin, user.pinHash))) {
      // In the public demo a wrong guess must not lock the shared staff out for other visitors.
      if (isDemoStore(c)) return c.json({ error: "wrong_pin" }, 401);
      const lockAfter = new Date(Date.now() + PIN_LOCK_MS);
      const [after] = await withStore(store.id, async (tx) => {
        await audit(tx, store.id, userId, "sign_in_failed", userId);
        return tx
          .update(users)
          .set({
            pinFailed: sql`case when ${users.pinFailed} + 1 >= ${MAX_ATTEMPTS} then 0 else ${users.pinFailed} + 1 end`,
            pinLockedUntil: sql`case when ${users.pinFailed} + 1 >= ${MAX_ATTEMPTS} then ${lockAfter.toISOString()}::timestamptz else ${users.pinLockedUntil} end`,
          })
          .where(where)
          .returning({ pinLockedUntil: users.pinLockedUntil });
      });
      return after?.pinLockedUntil && after.pinLockedUntil > new Date() ? c.json({ error: "locked" }, 423) : c.json({ error: "wrong_pin" }, 401);
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await withStore(store.id, async (tx) => {
      await tx.update(users).set({ pinFailed: 0, pinLockedUntil: null }).where(where);
      await tx.insert(sessions).values({ storeId: store.id, tokenHash: sha256(token), userId, deviceId: c.get("device").id, expiresAt });
      await audit(tx, store.id, userId, "sign_in", userId);
    });
    return c.json<SignInResponse>({ token, expiresAt: expiresAt.toISOString(), user: { id: user.id, name: user.name, role: user.role } });
  });

  app.get("/v1/staff", ...managers, async (c) => {
    const store = c.get("store");
    const rows = await withStore(store.id, (tx) =>
      tx
        .select({ id: users.id, name: users.name, role: users.role, email: users.email, phone: users.phone, disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.storeId, store.id))
        .orderBy(users.name),
    );
    return c.json<{ staff: StaffRecord[] }>({
      staff: rows.map(({ disabledAt, ...r }) => ({ ...r, disabled: disabledAt !== null })),
    });
  });

  app.post("/v1/staff", ...managers, async (c) => {
    const store = c.get("store");
    const actor = c.get("user");
    const input = staffCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? "invalid" }, 400);
    if (actor.role === "manager" && input.data.role !== "cashier") return c.json({ error: "forbidden" }, 403);
    const id = randomUUID();
    const pinHash = await hashPin(input.data.pin);
    try {
      await withStore(store.id, async (tx) => {
        await tx.insert(users).values({ storeId: store.id, id, name: input.data.name, email: input.data.email, phone: input.data.phone, role: input.data.role, pinHash });
        await audit(tx, store.id, actor.id, "staff_create", id, { name: input.data.name, role: input.data.role });
      });
    } catch (e) {
      const duplicate = duplicateContact(e);
      if (duplicate) return c.json({ error: duplicate }, 409);
      throw e;
    }
    return c.json({ id }, 201);
  });

  app.patch("/v1/staff/:id", ...managers, async (c) => {
    const store = c.get("store");
    const actor = c.get("user");
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const input = staffUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? "invalid" }, 400);
    const data = input.data;
    const where = and(eq(users.storeId, store.id), eq(users.id, id.data));

    const [target] = await withStore(store.id, (tx) => tx.select({ role: users.role }).from(users).where(where));
    if (!target) return c.json({ error: "not_found" }, 404);
    if (actor.role === "manager" && (target.role !== "cashier" || data.role !== "cashier")) return c.json({ error: "forbidden" }, 403);
    if (target.role === "owner" && (actor.id !== id.data || data.disabled)) return c.json({ error: "forbidden" }, 403);

    const role = target.role === "owner" ? "owner" : data.role;
    if (!hasContactIfManager({ ...data, role })) return c.json({ error: "email_required" }, 400);
    const pinHash = data.pin ? await hashPin(data.pin) : undefined;
    try {
      await withStore(store.id, async (tx) => {
        await tx
          .update(users)
          .set({
            name: data.name,
            email: data.email,
            phone: data.phone,
            role,
            disabledAt: data.disabled ? sql`coalesce(${users.disabledAt}, now())` : null,
            ...(pinHash ? { pinHash, pinFailed: 0, pinLockedUntil: null } : {}),
          })
          .where(where);
        await audit(tx, store.id, actor.id, "staff_update", id.data, { name: data.name, role, disabled: data.disabled, pinChanged: Boolean(pinHash) });
        // Anything that changes what this person may do ends their open sessions immediately.
        if (pinHash || data.disabled || role !== target.role) {
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(sessions.storeId, store.id), eq(sessions.userId, id.data), isNull(sessions.revokedAt)));
        }
      });
    } catch (e) {
      const duplicate = duplicateContact(e);
      if (duplicate) return c.json({ error: duplicate }, 409);
      throw e;
    }
    return c.json({ ok: true });
  });

  const owners = [requireDevice, requireSession, requireRole("owner")] as const;

  app.get("/v1/devices", ...owners, async (c) => {
    const store = c.get("store");
    const rows = await withStore(store.id, (tx) =>
      tx
        .select({ id: devices.id, name: devices.name, lastSeenAt: devices.lastSeenAt, branchId: devices.branchId })
        .from(devices)
        .where(and(eq(devices.storeId, store.id), isNull(devices.revokedAt)))
        .orderBy(desc(devices.lastSeenAt)),
    );
    return c.json<{ devices: DeviceRecord[]; currentId: string }>({
      devices: rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt.toISOString() })),
      currentId: c.get("device").id,
    });
  });

  app.patch("/v1/devices/:id", ...owners, async (c) => {
    const store = c.get("store");
    const id = uuid.safeParse(c.req.param("id"));
    const body = z.object({ branchId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: "not_found" }, 404);
    const updated = await withStore(store.id, async (tx) => {
      const rows = await tx.update(devices).set({ branchId: body.data.branchId }).where(and(eq(devices.storeId, store.id), eq(devices.id, id.data), isNull(devices.revokedAt))).returning({ id: devices.id });
      if (rows.length) await audit(tx, store.id, c.get("user").id, "device_branch", id.data, { branchId: body.data.branchId });
      return rows;
    });
    return updated.length ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/v1/devices/:id", ...owners, async (c) => {
    const store = c.get("store");
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const updated = await withStore(store.id, async (tx) => {
      const rows = await tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(and(eq(devices.storeId, store.id), eq(devices.id, id.data), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      if (rows.length) {
        await audit(tx, store.id, c.get("user").id, "device_disconnect", id.data);
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.storeId, store.id), eq(sessions.deviceId, id.data), isNull(sessions.revokedAt)));
      }
      return rows;
    });
    return updated.length ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });
}
