import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  deleteSession,
  findSessionUser,
  hashSessionToken,
  newSessionToken,
  sessionCookieOptions,
} from "../src/auth/session.js";
import { db } from "../src/db.js";

const DAY_MS = 86_400_000;
const T0 = new Date("2030-01-01T12:00:00.000Z");

// Seuls les jetons créés par le test en cours sont supprimés : les sessions ouvertes par `login()` des autres tests restent.
let created: string[] = [];

async function meId(): Promise<number> {
  const user = await db.user.findUniqueOrThrow({ where: { handle: "me" } });
  return user.id;
}

async function createForMe(now: Date = new Date()): Promise<string> {
  const { token } = await createSession(db, await meId(), now);
  created.push(token);
  return token;
}

afterEach(async () => {
  await db.session.deleteMany({ where: { tokenHash: { in: created.map((token) => hashSessionToken(token)) } } });
  created = [];
});

describe("session: jeton", () => {
  it("is a 43-character base64url string that decodes to 32 random bytes", () => {
    const token = newSessionToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("is different on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newSessionToken()));
    expect(tokens.size).toBe(50);
  });

  it("hashes to SHA-256 in lowercase hex (64 characters)", () => {
    const token = newSessionToken();
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashSessionToken(token)).toBe(expected);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("session: cookie", () => {
  it("uses the cookie name session and a 7-day lifetime", () => {
    expect(SESSION_COOKIE).toBe("session");
    expect(SESSION_TTL_SECONDS).toBe(604800);
  });

  it("is HttpOnly, SameSite=Lax, Path=/, Max-Age 7 days, without Secure outside production", () => {
    expect(sessionCookieOptions(false)).toEqual({ httpOnly: true, sameSite: "Lax", path: "/", maxAge: 604800, secure: false });
  });

  it("sets Secure when asked for it (production)", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});

describe("session: création", () => {
  it("returns the token in clear but stores only its hash", async () => {
    const userId = await meId();
    const { token } = await createSession(db, userId, T0);
    created.push(token);

    const row = await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(userId);
    expect(await db.session.findUnique({ where: { tokenHash: token } })).toBeNull();
  });

  it("sets expiresAt to now plus 7 days, in the returned value and in the database", async () => {
    const userId = await meId();
    const { token, expiresAt } = await createSession(db, userId, T0);
    created.push(token);

    expect(expiresAt.getTime()).toBe(T0.getTime() + 7 * DAY_MS);
    const row = await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    expect(row?.expiresAt.getTime()).toBe(T0.getTime() + 7 * DAY_MS);
  });

  it("uses the current time when no now is given", async () => {
    const before = Date.now();
    const { token, expiresAt } = await createSession(db, await meId());
    created.push(token);
    const after = Date.now();

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 7 * DAY_MS);
  });
});

describe("session: retrouver l'utilisateur", () => {
  it("returns the user of a live session with exactly id, handle and displayName", async () => {
    const token = await createForMe(T0);
    const user = await findSessionUser(db, token, new Date(T0.getTime() + DAY_MS));
    expect(user).toEqual({ id: await meId(), handle: "me", displayName: "Moi" });
  });

  it("returns null for an unknown token", async () => {
    expect(await findSessionUser(db, newSessionToken())).toBeNull();
  });

  it("returns null when expiresAt is already in the past", async () => {
    const token = await createForMe(new Date(T0.getTime() - 8 * DAY_MS));
    expect(await findSessionUser(db, token, T0)).toBeNull();
  });

  it("returns null exactly at expiresAt", async () => {
    const token = await createForMe(T0);
    expect(await findSessionUser(db, token, new Date(T0.getTime() + 7 * DAY_MS))).toBeNull();
  });

  it("still returns the user one millisecond before expiresAt", async () => {
    const token = await createForMe(T0);
    const user = await findSessionUser(db, token, new Date(T0.getTime() + 7 * DAY_MS - 1));
    expect(user?.handle).toBe("me");
  });
});

describe("session: suppression", () => {
  it("deletes the session, so the token no longer resolves", async () => {
    const token = await createForMe();
    expect(await findSessionUser(db, token)).not.toBeNull();

    await deleteSession(db, token);

    expect(await findSessionUser(db, token)).toBeNull();
    expect(await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) } })).toBeNull();
  });

  it("does not throw for an unknown token", async () => {
    await expect(deleteSession(db, newSessionToken())).resolves.toBeUndefined();
  });
});
