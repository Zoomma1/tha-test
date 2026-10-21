import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loginLimiter } from "../src/auth/login-limiter.js";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { DEMO_PASSWORD, readJson } from "./helpers.js";

const publicUserSchema = z.strictObject({ id: z.number(), handle: z.string(), displayName: z.string() });
const errorSchema = z.strictObject({ error: z.string().min(1) });

const PASSWORD = "correct-horse-9";
const ME = { id: 1, handle: "me", displayName: "Moi" };

async function postLogin(body: unknown): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postRawLogin(raw: string): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
}

// Pseudo aléatoire, toujours conforme à ^[a-z0-9_]{n}$ (hexadécimal minuscule).
function freshHandle(): string {
  return randomBytes(6).toString("hex");
}

// Chaque test enregistre les handles qu'il touche (avant la requête, pour nettoyer même en cas d'échec) et les supprime ensuite.
const touchedHandles: string[] = [];

function track(handle: string): string {
  touchedHandles.push(handle);
  return handle;
}

// Utilisateur créé par le test via l'inscription publique : jamais `me`, pour ne pas le bloquer.
async function createUser(): Promise<string> {
  const handle = track(freshHandle());
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  return handle;
}

// Jetons de session créés par les connexions réussies de `me` : seuls ceux-là sont supprimés.
const meTokens: string[] = [];

function sessionPair(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function tokenOf(pair: string): string {
  return pair.slice("session=".length);
}

afterEach(async () => {
  for (const handle of touchedHandles.splice(0)) {
    loginLimiter.reset(handle);
    await db.session.deleteMany({ where: { user: { handle } } });
    await db.user.deleteMany({ where: { handle } });
  }
  loginLimiter.reset("me");
  const hashes = meTokens.splice(0).map((token) => createHash("sha256").update(token).digest("hex"));
  await db.session.deleteMany({ where: { tokenHash: { in: hashes } } });
});

describe("POST /api/auth/login: connexion réussie (200)", () => {
  it("returns 200 with exactly the public user of me", async () => {
    const res = await postLogin({ handle: "me", password: DEMO_PASSWORD });
    meTokens.push(tokenOf(sessionPair(res)));
    expect(res.status).toBe(200);
    expect(await readJson(res, publicUserSchema)).toEqual(ME);
  });

  it("sets a session cookie named session with a 32-byte base64url token", async () => {
    const res = await postLogin({ handle: "me", password: DEMO_PASSWORD });
    const setCookie = res.headers.get("set-cookie") ?? "";
    meTokens.push(tokenOf(sessionPair(res)));
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
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await postLogin({ handle: "me", password: DEMO_PASSWORD });
      meTokens.push(tokenOf(sessionPair(res)));
      const attributes = (res.headers.get("set-cookie") ?? "").split(";").map((part) => part.trim().toLowerCase());
      expect(attributes).toContain("secure");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("gives a different session cookie to each login", async () => {
    const first = await postLogin({ handle: "me", password: DEMO_PASSWORD });
    const second = await postLogin({ handle: "me", password: DEMO_PASSWORD });
    meTokens.push(tokenOf(sessionPair(first)), tokenOf(sessionPair(second)));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(sessionPair(first)).toMatch(/^session=[A-Za-z0-9_-]{43}$/);
    expect(sessionPair(second)).toMatch(/^session=[A-Za-z0-9_-]{43}$/);
    expect(sessionPair(first)).not.toBe(sessionPair(second));
  });
});

describe("POST /api/auth/login: identifiants faux (401)", () => {
  it("answers 401 invalid credentials for a wrong password", async () => {
    const handle = await createUser();
    const res = await postLogin({ handle, password: "wrong-password-0" });
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid credentials" });
  });

  it("answers 401 invalid credentials for an unknown handle", async () => {
    const res = await postLogin({ handle: track(freshHandle()), password: PASSWORD });
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid credentials" });
  });

  it("gives the same status and the same body for a wrong password and an unknown handle", async () => {
    const handle = await createUser();
    const wrongPassword = await postLogin({ handle, password: "wrong-password-0" });
    const unknownHandle = await postLogin({ handle: track(freshHandle()), password: "wrong-password-0" });
    expect(wrongPassword.status).toBe(401);
    expect(await readJson(wrongPassword, errorSchema)).toEqual({ error: "invalid credentials" });
    expect(unknownHandle.status).toBe(401);
    expect(await readJson(unknownHandle, errorSchema)).toEqual({ error: "invalid credentials" });
  });

  it("sets no session cookie on a failed login", async () => {
    const handle = await createUser();
    const res = await postLogin({ handle, password: "wrong-password-0" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/auth/login: corps invalide (400)", () => {
  it.each([
    ["a missing password", { handle: "me" }],
    ["a missing handle", { password: DEMO_PASSWORD }],
    ["an empty handle", { handle: "", password: DEMO_PASSWORD }],
    ["an empty password", { handle: "me", password: "" }],
    ["a non-string handle", { handle: 42, password: DEMO_PASSWORD }],
    ["a non-string password", { handle: "me", password: 12345 }],
    ["an empty object", {}],
  ])("rejects %s with 400 invalid body", async (_label, body) => {
    const res = await postLogin(body);
    expect(res.status).toBe(400);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid body" });
  });

  it("rejects a body that is not JSON with 400 invalid body", async () => {
    const res = await postRawLogin("{not json");
    expect(res.status).toBe(400);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid body" });
  });

  it("rejects an empty body with 400 invalid body", async () => {
    const res = await postRawLogin("");
    expect(res.status).toBe(400);
    expect(await readJson(res, errorSchema)).toEqual({ error: "invalid body" });
  });
});

describe("POST /api/auth/login: limitation des tentatives (429)", () => {
  it("answers 429 with a positive Retry-After after 5 failures, even with the right password", async () => {
    const handle = await createUser();
    for (let i = 0; i < 5; i += 1) {
      const failed = await postLogin({ handle, password: "wrong-password-0" });
      expect(failed.status).toBe(401);
    }

    const blocked = await postLogin({ handle, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(await readJson(blocked, errorSchema)).toEqual({ error: "too many attempts" });
    expect(blocked.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("keeps answering 429 for a wrong password once the limit is reached", async () => {
    const handle = await createUser();
    for (let i = 0; i < 5; i += 1) {
      await postLogin({ handle, password: "wrong-password-0" });
    }

    const res = await postLogin({ handle, password: "wrong-password-0" });
    expect(res.status).toBe(429);
    expect(await readJson(res, errorSchema)).toEqual({ error: "too many attempts" });
  });

  it("does not block another handle when one handle has reached the limit", async () => {
    const blockedHandle = await createUser();
    const otherHandle = await createUser();
    for (let i = 0; i < 5; i += 1) {
      await postLogin({ handle: blockedHandle, password: "wrong-password-0" });
    }

    const res = await postLogin({ handle: otherHandle, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await readJson(res, publicUserSchema)).toMatchObject({ handle: otherHandle });
  });

  it("restarts the count after a successful login", async () => {
    const handle = await createUser();
    for (let i = 0; i < 4; i += 1) {
      await postLogin({ handle, password: "wrong-password-0" });
    }
    const success = await postLogin({ handle, password: PASSWORD });
    expect(success.status).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      const failed = await postLogin({ handle, password: "wrong-password-0" });
      expect(failed.status).toBe(401);
    }
    const blocked = await postLogin({ handle, password: "wrong-password-0" });
    expect(blocked.status).toBe(429);
  });
});
