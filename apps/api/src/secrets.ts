import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = await scryptAsync(pin, Buffer.from(salt, "hex"), 32);
  return safeEqual(actual.toString("hex"), hash);
}
