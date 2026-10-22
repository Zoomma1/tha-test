import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { SEED_OWNED } from "../src/seed-data.js";
import { authed, get, partSchema, readJson } from "./helpers.js";

const ownedPartSchema = z.object({
  id: z.number(),
  partId: z.number(),
  quantity: z.number(),
  part: partSchema,
});

const listSchema = z.array(ownedPartSchema);
const unauthorizedSchema = z.strictObject({ error: z.literal("unauthorized") });
const notFoundSchema = z.strictObject({ error: z.literal("not found") });

// Jeton bien formé (32 octets en base64url, 43 caractères) mais inconnu de la base.
const UNKNOWN_SESSION = `session=${"A".repeat(43)}`;
const jsonHeaders = { "content-type": "application/json" };

// Chaque test crée ses pièces et ses lignes d'inventaire, puis les supprime : test.db est partagée.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id };
}

async function postAs(as: string, body: unknown): Promise<Response> {
  return authed("/api/owned-parts", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) }, as);
}

async function patchAs(as: string, id: number, body: unknown): Promise<Response> {
  return authed(`/api/owned-parts/${String(id)}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) }, as);
}

async function deleteAs(as: string, id: number): Promise<Response> {
  return authed(`/api/owned-parts/${String(id)}`, { method: "DELETE" }, as);
}

async function listAs(as: string): Promise<z.output<typeof listSchema>> {
  return readJson(await authed("/api/owned-parts", {}, as), listSchema);
}

async function rowsFor(partId: number, as: string): Promise<z.output<typeof listSchema>> {
  const body = await listAs(as);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const partIds = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("sans cookie : 401 sur chaque route", () => {
  it("GET /api/owned-parts answers 401 unauthorized", async () => {
    const res = await get("/api/owned-parts");
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });

  it("POST /api/owned-parts answers 401 and creates no row", async () => {
    const part = await makePart();
    const res = await app.request("/api/owned-parts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ partId: part.id, quantity: 2 }),
    });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([]);
  });

  it("PATCH /api/owned-parts/:id answers 401 and keeps the quantity", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);

    const res = await app.request(`/api/owned-parts/${String(created.id)}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ quantity: 9 }),
    });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([created]);
  });

  it("DELETE /api/owned-parts/:id answers 401 and keeps the row", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);

    const res = await app.request(`/api/owned-parts/${String(created.id)}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([created]);
  });

  it("answers 401 unauthorized for a session token the database does not know", async () => {
    const res = await app.request("/api/owned-parts", { headers: { cookie: UNKNOWN_SESSION } });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });
});

describe("isolation : chaque utilisateur ne voit et ne touche que son inventaire", () => {
  it("a row created by alice does not appear in me's list, and the reverse holds", async () => {
    const part = await makePart();
    const res = await postAs("alice", { partId: part.id, quantity: 4 });
    expect(res.status).toBe(201);
    const created = await readJson(res, ownedPartSchema);

    expect(await rowsFor(part.id, "alice")).toEqual([created]);
    expect(await rowsFor(part.id, "me")).toEqual([]);
    expect((await listAs("me")).map((row) => row.id)).not.toContain(created.id);

    const mine = await readJson(await postAs("me", { partId: part.id, quantity: 1 }), ownedPartSchema);
    expect((await listAs("alice")).map((row) => row.id)).not.toContain(mine.id);
  });

  it("does not show me's seeded rows in alice's list", async () => {
    const aliceRows = await listAs("alice");
    for (const seed of SEED_OWNED) {
      expect(aliceRows.find((row) => row.part.name === seed.partName)).toBeUndefined();
    }
  });

  it("refuses me to change alice's row with 404 not found, and alice's quantity stays", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("alice", { partId: part.id, quantity: 4 }), ownedPartSchema);

    const res = await patchAs("me", created.id, { quantity: 9 });
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
    expect(await rowsFor(part.id, "alice")).toEqual([created]);

    const own = await patchAs("alice", created.id, { quantity: 6 });
    expect(own.status).toBe(200);
    expect((await readJson(own, ownedPartSchema)).quantity).toBe(6);
  });

  it("refuses me to delete alice's row with 404 not found, and alice can still delete it", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("alice", { partId: part.id, quantity: 4 }), ownedPartSchema);

    const denied = await deleteAs("me", created.id);
    expect(denied.status).toBe(404);
    expect(await readJson(denied, notFoundSchema)).toEqual({ error: "not found" });
    expect(await rowsFor(part.id, "alice")).toEqual([created]);

    expect((await deleteAs("alice", created.id)).status).toBe(204);
    expect(await rowsFor(part.id, "alice")).toEqual([]);
  });

  it("keeps one row per user for the same part, each with its own quantity", async () => {
    const part = await makePart();
    const aliceRow = await readJson(await postAs("alice", { partId: part.id, quantity: 7 }), ownedPartSchema);
    const meRow = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);
    expect(meRow.id).not.toBe(aliceRow.id);

    const meAgain = await postAs("me", { partId: part.id, quantity: 2 });
    expect(meAgain.status).toBe(200);
    expect((await readJson(meAgain, ownedPartSchema)).quantity).toBe(5);

    expect((await rowsFor(part.id, "me")).map((row) => row.quantity)).toEqual([5]);
    expect((await rowsFor(part.id, "alice")).map((row) => row.quantity)).toEqual([7]);
  });
});
