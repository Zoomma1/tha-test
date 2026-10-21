import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { DEMO_PASSWORD, readJson } from "./helpers.js";

const publicUserSchema = z.strictObject({ id: z.number(), handle: z.string(), displayName: z.string() });
const errorSchema = z.strictObject({ error: z.string().min(1) });

const ME = { id: 1, handle: "me", displayName: "Moi" };
const UNAUTHORIZED = { error: "unauthorized" };

// Jetons créés par ce fichier (connexions ouvertes, sessions expirées insérées) : seuls ceux-là sont supprimés.
// Pas `login()` du helper : `/logout` révoquerait la session mise en cache pour `me`, utilisée par les autres tests.
const createdHashes: string[] = [];

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenOf(pair: string): string {
  return pair.slice("session=".length);
}

// Ouvre une session pour `me` via l'interface publique et renvoie le couple `session=...`.
async function openSession(): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "me", password: DEMO_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const pair = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  createdHashes.push(hashOf(tokenOf(pair)));
  return pair;
}

// Session dont `expiresAt` est dans le passé, insérée directement en base par le test.
async function insertExpiredSession(): Promise<string> {
  const me = await db.user.findUniqueOrThrow({ where: { handle: "me" } });
  const token = randomBytes(32).toString("base64url");
  createdHashes.push(hashOf(token));
  await db.session.create({
    data: { userId: me.id, tokenHash: hashOf(token), expiresAt: new Date(Date.now() - 60_000) },
  });
  return token;
}

async function getMe(cookie?: string): Promise<Response> {
  return app.request("/api/auth/me", cookie === undefined ? {} : { headers: { cookie } });
}

async function postLogout(cookie?: string): Promise<Response> {
  return app.request("/api/auth/logout", {
    method: "POST",
    headers: cookie === undefined ? {} : { cookie },
  });
}

afterEach(async () => {
  await db.session.deleteMany({ where: { tokenHash: { in: createdHashes.splice(0) } } });
});

describe("GET /api/auth/me: session valide (200)", () => {
  it("returns 200 with exactly the public user of me after a login", async () => {
    const pair = await openSession();
    const res = await getMe(pair);
    expect(res.status).toBe(200);
    expect(await readJson(res, publicUserSchema)).toEqual(ME);
  });
});

describe("GET /api/auth/me: non authentifié (401)", () => {
  it("answers 401 unauthorized without a cookie", async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual(UNAUTHORIZED);
  });

  it("answers 401 unauthorized for an invented token", async () => {
    const invented = randomBytes(32).toString("base64url");
    const res = await getMe(`session=${invented}`);
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual(UNAUTHORIZED);
  });

  it("answers 401 unauthorized for a session whose expiresAt is in the past", async () => {
    const expired = await insertExpiredSession();
    const res = await getMe(`session=${expired}`);
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual(UNAUTHORIZED);
  });
});

describe("POST /api/auth/logout: déconnexion (204)", () => {
  it("answers 204 with no body", async () => {
    const pair = await openSession();
    const res = await postLogout(pair);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("deletes the session row in the database", async () => {
    const pair = await openSession();
    const res = await postLogout(pair);
    expect(res.status).toBe(204);
    const row = await db.session.findUnique({ where: { tokenHash: hashOf(tokenOf(pair)) } });
    expect(row).toBeNull();
  });

  it("sets a session cookie that empties session with Max-Age=0", async () => {
    const pair = await openSession();
    const res = await postLogout(pair);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const [cleared = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
    expect(cleared).toBe("session=");
    expect(attributes.map((attr) => attr.toLowerCase())).toContain("max-age=0");
  });

  it("answers 401 on /me with the same cookie afterwards", async () => {
    const pair = await openSession();
    expect((await postLogout(pair)).status).toBe(204);
    const res = await getMe(pair);
    expect(res.status).toBe(401);
    expect(await readJson(res, errorSchema)).toEqual(UNAUTHORIZED);
  });

  it("leaves the other sessions of me valid", async () => {
    const logged = await openSession();
    const other = await openSession();
    expect((await postLogout(logged)).status).toBe(204);
    const res = await getMe(other);
    expect(res.status).toBe(200);
    expect(await readJson(res, publicUserSchema)).toEqual(ME);
  });

  it("answers 204 without a cookie", async () => {
    const res = await postLogout();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("answers 204 when the session no longer exists", async () => {
    const pair = await openSession();
    expect((await postLogout(pair)).status).toBe(204);
    const res = await postLogout(pair);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("answers 204 for an invented token", async () => {
    const invented = randomBytes(32).toString("base64url");
    const res = await postLogout(`session=${invented}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});
