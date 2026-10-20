import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type AuthEnv, requireAuth } from "../src/auth/require-auth.js";
import { createSession, hashSessionToken, newSessionToken } from "../src/auth/session.js";
import { db } from "../src/db.js";
import { readJson } from "./helpers.js";

const DAY_MS = 86_400_000;

const userSchema = z.strictObject({ id: z.number(), handle: z.string(), displayName: z.string() });
const unauthorizedSchema = z.strictObject({ error: z.literal("unauthorized") });

// Mini-application de test : une seule route protégée qui renvoie l'utilisateur posé par le middleware.
// `protectedRuns` compte les exécutions de la route, pour vérifier qu'un refus ne la lance jamais.
let protectedRuns = 0;
const probe = new Hono<AuthEnv>().get("/probe", requireAuth, (c) => {
  protectedRuns += 1;
  return c.json(c.get("user"));
});

// Seuls les jetons créés par le test en cours sont supprimés : les sessions ouvertes par `login()` des autres tests restent.
let created: string[] = [];

async function meId(): Promise<number> {
  const user = await db.user.findUniqueOrThrow({ where: { handle: "me" } });
  return user.id;
}

async function sessionFor(now: Date = new Date()): Promise<string> {
  const { token } = await createSession(db, await meId(), now);
  created.push(token);
  return token;
}

beforeEach(() => {
  protectedRuns = 0;
});

afterEach(async () => {
  await db.session.deleteMany({ where: { tokenHash: { in: created.map((token) => hashSessionToken(token)) } } });
  created = [];
});

describe("requireAuth", () => {
  it("passes a valid session cookie and exposes its user to the route", async () => {
    const token = await sessionFor();
    const res = await probe.request("/probe", { headers: { cookie: `session=${token}` } });

    expect(res.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { handle: "me" } });
    expect(await readJson(res, userSchema)).toEqual({ id: user.id, handle: "me", displayName: user.displayName });
    expect(protectedRuns).toBe(1);
  });

  it("answers 401 unauthorized when there is no cookie", async () => {
    const res = await probe.request("/probe");

    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(protectedRuns).toBe(0);
  });

  it("answers 401 unauthorized for an unknown session token", async () => {
    const res = await probe.request("/probe", { headers: { cookie: `session=${newSessionToken()}` } });

    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(protectedRuns).toBe(0);
  });

  it("answers 401 unauthorized for an expired session", async () => {
    // Créée il y a huit jours : sa durée de 7 jours la rend expirée depuis hier.
    const token = await sessionFor(new Date(Date.now() - 8 * DAY_MS));
    const res = await probe.request("/probe", { headers: { cookie: `session=${token}` } });

    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(protectedRuns).toBe(0);
  });

  it("answers 401 unauthorized when only another cookie is sent", async () => {
    const res = await probe.request("/probe", { headers: { cookie: "other=1" } });

    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(protectedRuns).toBe(0);
  });
});
