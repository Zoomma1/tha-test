import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { readJson } from "./helpers.js";

const publicUserSchema = z.object({ id: z.number(), handle: z.string(), displayName: z.string() }).strict();
const errorSchema = z.object({ error: z.string().min(1) }).strict();
const idRowsSchema = z.array(z.object({ id: z.number() }));
const passwordRowsSchema = z.array(z.object({ passwordHash: z.string() }));
const tokenRowsSchema = z.array(z.object({ tokenHash: z.string(), userId: z.number() }));

const PASSWORD = "correct-horse-9";

async function postRegister(body: unknown): Promise<Response> {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postRawRegister(raw: string): Promise<Response> {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
}

// Pseudo aléatoire, toujours conforme à ^[a-z0-9_]{n}$ (hexadécimal minuscule).
function handleOfLength(n: number): string {
  return randomBytes(n).toString("hex").slice(0, n);
}

// Chaque test enregistre les handles qu'il crée (avant la requête, pour nettoyer même en cas d'échec) et les supprime ensuite.
const createdHandles: string[] = [];

function track(handle: string): string {
  createdHandles.push(handle);
  return handle;
}

async function userIdOf(handle: string): Promise<number | undefined> {
  const rows = idRowsSchema.parse(await db.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = ${handle}`);
  return rows[0]?.id;
}

afterEach(async () => {
  const handles = createdHandles.splice(0);
  for (const handle of handles) {
    await db.$executeRaw`DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "handle" = ${handle})`;
    await db.$executeRaw`DELETE FROM "User" WHERE "handle" = ${handle}`;
  }
});

describe("POST /api/auth/register: création (201)", () => {
  it("returns 201 with exactly the public user, and no password field", async () => {
    const handle = track(handleOfLength(10));
    const res = await postRegister({ handle, password: PASSWORD, displayName: "Nouvelle" });
    expect(res.status).toBe(201);
    const body = await readJson(res, publicUserSchema);
    expect(body).toEqual({ id: await userIdOf(handle), handle, displayName: "Nouvelle" });
  });

  it("uses the handle as displayName when displayName is omitted", async () => {
    const handle = track(handleOfLength(8));
    const res = await postRegister({ handle, password: PASSWORD });
    expect(res.status).toBe(201);
    const body = await readJson(res, publicUserSchema);
    expect(body.displayName).toBe(handle);
  });

  it("sets a session cookie named session with a 32-byte base64url token", async () => {
    const handle = track(handleOfLength(9));
    const res = await postRegister({ handle, password: PASSWORD });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
    expect(pair).toMatch(/^session=[A-Za-z0-9_-]{43}$/);
    const lowered = attributes.map((attr) => attr.toLowerCase());
    expect(lowered).toContain("httponly");
    expect(lowered).toContain("samesite=lax");
    expect(lowered).toContain("path=/");
    expect(lowered).toContain("max-age=604800");
    expect(lowered).not.toContain("secure");
  });

  it("sets Secure on the session cookie when NODE_ENV is production", async () => {
    const handle = track(handleOfLength(11));
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await postRegister({ handle, password: PASSWORD });
      const attributes = (res.headers.get("set-cookie") ?? "").split(";").map((part) => part.trim().toLowerCase());
      expect(attributes).toContain("secure");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("stores only the SHA-256 hash of the session token, linked to the new user", async () => {
    const handle = track(handleOfLength(12));
    const res = await postRegister({ handle, password: PASSWORD });
    expect(res.status).toBe(201);
    const token = (res.headers.get("set-cookie") ?? "").split(";")[0]?.slice("session=".length) ?? "";
    const userId = await userIdOf(handle);
    expect(userId).toBeDefined();

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const rows = tokenRowsSchema.parse(await db.$queryRaw`SELECT "tokenHash", "userId" FROM "Session" WHERE "tokenHash" = ${tokenHash}`);
    expect(rows).toEqual([{ tokenHash, userId }]);
  });

  it("stores the password hashed in scrypt format, never in clear", async () => {
    const handle = track(handleOfLength(13));
    await postRegister({ handle, password: PASSWORD });
    const userId = await userIdOf(handle);
    const rows = passwordRowsSchema.parse(await db.$queryRaw`SELECT "passwordHash" FROM "User" WHERE "id" = ${userId ?? -1}`);
    const stored = rows[0]?.passwordHash ?? "";
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain(PASSWORD);
  });

  it.each([
    ["a 3-character handle", 3],
    ["a 20-character handle", 20],
  ])("accepts %s", async (_label, length) => {
    const handle = track(handleOfLength(length));
    const res = await postRegister({ handle, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(await readJson(res, publicUserSchema)).toMatchObject({ handle });
  });

  it.each([
    ["an 8-character password", "abcdefgh"],
    ["a 72-character password", "p".repeat(72)],
  ])("accepts %s", async (_label, password) => {
    const handle = track(handleOfLength(14));
    const res = await postRegister({ handle, password });
    expect(res.status).toBe(201);
    await readJson(res, publicUserSchema);
  });

  it.each([
    ["a 1-character displayName", "d"],
    ["a 40-character displayName", "d".repeat(40)],
  ])("accepts %s", async (_label, displayName) => {
    const handle = track(handleOfLength(15));
    const res = await postRegister({ handle, password: PASSWORD, displayName });
    expect(res.status).toBe(201);
    expect(await readJson(res, publicUserSchema)).toMatchObject({ displayName });
  });
});

describe("POST /api/auth/register: corps invalide (400)", () => {
  it.each([
    ["a handle too short", { handle: "ab", password: PASSWORD }],
    ["a handle too long", { handle: "a".repeat(21), password: PASSWORD }],
    ["a handle with an uppercase letter", { handle: "Alice", password: PASSWORD }],
    ["a handle with a dash", { handle: "al-ice", password: PASSWORD }],
    ["a handle with a space", { handle: "al ice", password: PASSWORD }],
    ["a handle with an accent", { handle: "álice", password: PASSWORD }],
    ["an empty handle", { handle: "", password: PASSWORD }],
    ["a password of 7 characters", { handle: handleOfLength(16), password: "abcdefg" }],
    ["a password of 73 characters", { handle: handleOfLength(16), password: "p".repeat(73) }],
    ["an empty displayName", { handle: handleOfLength(16), password: PASSWORD, displayName: "" }],
    ["a displayName of 41 characters", { handle: handleOfLength(16), password: PASSWORD, displayName: "d".repeat(41) }],
    ["a missing password", { handle: handleOfLength(16) }],
    ["a missing handle", { password: PASSWORD }],
    ["a non-string handle", { handle: 42, password: PASSWORD }],
  ])("rejects %s with 400 invalid body", async (_label, body) => {
    const res = await postRegister(body);
    expect(res.status).toBe(400);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid body" });
  });

  it("rejects a body that is not JSON with 400 invalid body", async () => {
    const res = await postRawRegister("{not json");
    expect(res.status).toBe(400);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid body" });
  });
});

describe("POST /api/auth/register: handle déjà pris (409)", () => {
  it("answers 409 handle taken the second time the same handle is registered", async () => {
    const handle = track(handleOfLength(10));
    const first = await postRegister({ handle, password: PASSWORD });
    expect(first.status).toBe(201);

    const second = await postRegister({ handle, password: "another-password-2" });
    expect(second.status).toBe(409);
    expect(await readJson(second, errorSchema)).toEqual({ error: "handle taken" });
  });

  it("does not create a second user row for the taken handle", async () => {
    const handle = track(handleOfLength(10));
    await postRegister({ handle, password: PASSWORD });
    await postRegister({ handle, password: PASSWORD });
    const rows = idRowsSchema.parse(await db.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = ${handle}`);
    expect(rows).toHaveLength(1);
  });

  it("answers 409 handle taken for the seeded handle me", async () => {
    const res = await postRegister({ handle: "me", password: PASSWORD });
    expect(res.status).toBe(409);
    expect(await readJson(res, errorSchema)).toEqual({ error: "handle taken" });
  });
});
