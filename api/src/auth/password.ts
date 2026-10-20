import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keyLength, { N: n, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(plain, salt, N, R, P, KEY_LENGTH);
  return `scrypt$${String(N)}$${String(R)}$${String(P)}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  if (saltStr === undefined || hashStr === undefined || saltStr === "" || hashStr === "") return false;
  const salt = Buffer.from(saltStr, "base64url");
  const expected = Buffer.from(hashStr, "base64url");
  try {
    const actual = await derive(plain, salt, n, r, p, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
