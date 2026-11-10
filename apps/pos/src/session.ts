import type { Role, SignInResponse, StaffMember } from "@lalcha/domain";
import { deleteMeta, getMeta, getPinVerifier, loadStaff, recordPinResult, saveStaff, savePinVerifier, setMeta } from "./local";

export type CurrentUser = { id: string; name: string; role: Role; token: string | null };
export type AuthState = { status: "loading" | "unpaired" | "paired"; user: CurrentUser | null; locked: boolean };

let state: AuthState = { status: "loading", user: null, locked: false };
let deviceToken: string | null = null;
const listeners = new Set<() => void>();

function update(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getAuth = () => state;
export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export async function initAuth() {
  deviceToken = await getMeta("device_token");
  update({ status: deviceToken ? "paired" : "unpaired" });
}

export const lock = () => {
  if (state.user) update({ locked: true });
};

async function unpair() {
  deviceToken = null;
  await deleteMeta("device_token");
  update({ status: "unpaired", user: null, locked: false });
}

/** All server calls go through here. Unsynced sales stay on the device if it gets signed out. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (deviceToken) headers.set("authorization", `Bearer ${deviceToken}`);
  if (state.user?.token) headers.set("x-session", state.user.token);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    const { error } = (await res.clone().json().catch(() => ({}))) as { error?: string };
    if (error === "device_unauthorized") await unpair();
    if (error === "session_required" && state.user) update({ user: { ...state.user, token: null }, locked: true });
  }
  return res;
}

/** An owner or manager is found by email first; a phone number works too once SMS is connected. */
export type Contact = { email: string } | { phone: string };

export async function requestCode(contact: Contact) {
  const res = await fetch("/v1/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error("request failed");
  return (await res.json()) as { devCode?: string };
}

export async function verifyCode(contact: Contact, code: string, deviceName: string) {
  const res = await fetch("/v1/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...contact, code, deviceName }),
  });
  if (res.status === 403) return "limit" as const;
  if (!res.ok) return "bad" as const;
  const { deviceToken: token } = (await res.json()) as { deviceToken: string };
  await setMeta("device_token", token);
  deviceToken = token;
  update({ status: "paired" });
  return "ok" as const;
}

/** Pages on the main website, which lives on the store address's parent domain. */
export function siteUrl(path: string) {
  const host = location.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) return `http://localhost:4174${path}`;
  return `https://${host.split(".").slice(1).join(".")}${path}`;
}

export type DemoInfo = { demo: boolean; staff?: (StaffMember & { pin: string })[] };
let demoInfo: Promise<DemoInfo> | null = null;
/** Whether this address is the public demo store. Asked once per page load. */
export function getDemo() {
  demoInfo ??= fetch("/v1/demo")
    .then((r) => (r.ok ? (r.json() as Promise<DemoInfo>) : { demo: false }))
    .catch(() => ({ demo: false }));
  return demoInfo;
}

/** Connects this browser to the demo store without a phone code. */
export async function connectDemo() {
  const res = await fetch("/v1/demo/connect", { method: "POST" });
  if (!res.ok) return false;
  const { deviceToken: token } = (await res.json()) as { deviceToken: string };
  await setMeta("device_token", token);
  deviceToken = token;
  update({ status: "paired" });
  return true;
}

/** Also forgets the offline PIN of anyone who has been removed from the store. */
export async function refreshStaff(): Promise<StaffMember[]> {
  try {
    const res = await apiFetch("/v1/auth/staff");
    if (res.ok) await saveStaff(((await res.json()) as { staff: StaffMember[] }).staff);
  } catch {
    // Offline: the list saved on this device is used instead.
  }
  return loadStaff();
}

const PBKDF2_ITERATIONS = 150_000;
const hex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
}

export type SignInResult = "ok" | "wrong_pin" | "locked" | "needs_online";

const OFFLINE_LOCK_MS = 5 * 60_000;

/** Only people who have signed in online on this device can sign in here during an outage. */
async function signInOffline(staff: StaffMember, pin: string): Promise<SignInResult> {
  const verifier = await getPinVerifier(staff.id);
  if (!verifier) return "needs_online";
  if (verifier.lockedUntil > Date.now()) return "locked";
  const matches = (await derive(pin, unhex(verifier.salt), verifier.iterations)) === verifier.hash;
  const failed = matches ? 0 : verifier.failed + 1;
  const lockNow = failed >= 5;
  await recordPinResult(staff.id, lockNow ? 0 : failed, lockNow ? Date.now() + OFFLINE_LOCK_MS : 0);
  if (lockNow) return "locked";
  if (!matches) return "wrong_pin";
  update({ user: { id: staff.id, name: staff.name, role: staff.role, token: null }, locked: false });
  return "ok";
}

export async function signIn(staff: StaffMember, pin: string): Promise<SignInResult> {
  let res: Response;
  try {
    res = await apiFetch("/v1/auth/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: staff.id, pin }),
    });
  } catch {
    return signInOffline(staff, pin);
  }
  if (res.status >= 500) return signInOffline(staff, pin);
  if (res.status === 423) return "locked";
  if (!res.ok) return "wrong_pin";

  const body = (await res.json()) as SignInResponse;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await savePinVerifier(staff.id, hex(salt), await derive(pin, salt, PBKDF2_ITERATIONS), PBKDF2_ITERATIONS);
  update({ user: { ...body.user, token: body.token }, locked: false });
  return "ok";
}
