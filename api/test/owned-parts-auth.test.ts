import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
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

// Chaque test crée ses propres pièces (aucune ligne d'inventaire dans le seed) et les supprime ensuite, avec les lignes de tous les utilisateurs.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

async function postAs(as: string, body: unknown): Promise<Response> {
  return authed(
    "/api/owned-parts",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    as,
  );
}

async function patchAs(as: string, id: number, body: unknown): Promise<Response> {
  return authed(
    `/api/owned-parts/${String(id)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    as,
  );
}

async function deleteAs(as: string, id: number): Promise<Response> {
  return authed(`/api/owned-parts/${String(id)}`, { method: "DELETE" }, as);
}

async function listAs(as: string): Promise<z.output<typeof listSchema>> {
  return readJson(await authed("/api/owned-parts", {}, as), listSchema);
}

async function rowsForAs(as: string, partId: number): Promise<z.output<typeof listSchema>> {
  return (await listAs(as)).filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("routes d'inventaire sans cookie valide : 401 unauthorized", () => {
  it("answers 401 with { error: 'unauthorized' } on GET /api/owned-parts", async () => {
    const res = await app.request("/api/owned-parts");
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });

  it("answers 401 on GET /api/owned-parts with a cookie that is not a session", async () => {
    const res = await app.request("/api/owned-parts", { headers: { cookie: "session=not-a-real-session-token" } });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });

  it("answers 401 on POST /api/owned-parts and creates no row for anyone", async () => {
    const part = await makePart();
    const res = await app.request("/api/owned-parts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId: part.id, quantity: 2 }),
    });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsForAs("me", part.id)).toEqual([]);
    expect(await rowsForAs("alice", part.id)).toEqual([]);
  });

  it("answers 401 on PATCH /api/owned-parts/:id and keeps the row unchanged", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);

    const res = await app.request(`/api/owned-parts/${String(created.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity: 9 }),
    });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect((await rowsForAs("me", part.id))[0]?.quantity).toBe(3);
  });

  it("answers 401 on DELETE /api/owned-parts/:id and keeps the row", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);

    const res = await app.request(`/api/owned-parts/${String(created.id)}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsForAs("me", part.id)).toEqual([created]);
  });
});

describe("GET /api/parts reste public", () => {
  it("answers 200 with the parts list, without any cookie", async () => {
    const res = await get("/api/parts");
    expect(res.status).toBe(200);
    expect((await readJson(res, z.array(partSchema))).length).toBeGreaterThan(0);
  });
});

describe("isolation : chaque utilisateur ne voit que ses lignes", () => {
  it("does not list a row created by alice in me's list, and the reverse", async () => {
    const aliceRowPart = await makePart();
    const meRowPart = await makePart();
    const aliceRow = await readJson(await postAs("alice", { partId: aliceRowPart.id, quantity: 2 }), ownedPartSchema);
    const meRow = await readJson(await postAs("me", { partId: meRowPart.id, quantity: 3 }), ownedPartSchema);

    const meIds = (await listAs("me")).map((row) => row.id);
    const aliceIds = (await listAs("alice")).map((row) => row.id);

    expect(meIds).toContain(meRow.id);
    expect(meIds).not.toContain(aliceRow.id);
    expect(aliceIds).toContain(aliceRow.id);
    expect(aliceIds).not.toContain(meRow.id);
  });

  it("creates two distinct rows when me and alice add the same part, each with its own quantity", async () => {
    const part = await makePart();

    const meRes = await postAs("me", { partId: part.id, quantity: 3 });
    expect(meRes.status).toBe(201);
    const meRow = await readJson(meRes, ownedPartSchema);

    const aliceRes = await postAs("alice", { partId: part.id, quantity: 4 });
    expect(aliceRes.status).toBe(201);
    const aliceRow = await readJson(aliceRes, ownedPartSchema);

    expect(aliceRow.id).not.toBe(meRow.id);
    expect(await rowsForAs("me", part.id)).toEqual([meRow]);
    expect(await rowsForAs("alice", part.id)).toEqual([aliceRow]);
    expect(meRow.quantity).toBe(3);
    expect(aliceRow.quantity).toBe(4);
  });

  it("adds to me's own row only, leaving alice's quantity unchanged", async () => {
    const part = await makePart();
    await postAs("me", { partId: part.id, quantity: 3 });
    await postAs("alice", { partId: part.id, quantity: 4 });

    const res = await postAs("me", { partId: part.id, quantity: 2 });
    expect(res.status).toBe(200);
    expect((await readJson(res, ownedPartSchema)).quantity).toBe(5);

    expect((await rowsForAs("me", part.id))[0]?.quantity).toBe(5);
    expect((await rowsForAs("alice", part.id))[0]?.quantity).toBe(4);
  });

  it("answers 404 not found when me patches a row of alice, and alice's row is unchanged", async () => {
    const part = await makePart();
    const aliceRow = await readJson(await postAs("alice", { partId: part.id, quantity: 2 }), ownedPartSchema);

    const res = await patchAs("me", aliceRow.id, { quantity: 9 });
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
    expect((await rowsForAs("alice", part.id))[0]?.quantity).toBe(2);
  });

  it("answers 404 not found when me deletes a row of alice, and the row stays in alice's list", async () => {
    const part = await makePart();
    const aliceRow = await readJson(await postAs("alice", { partId: part.id, quantity: 2 }), ownedPartSchema);

    const res = await deleteAs("me", aliceRow.id);
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
    expect(await rowsForAs("alice", part.id)).toEqual([aliceRow]);
  });

  it("answers 404 not found when alice patches or deletes a row of me, and the row is unchanged", async () => {
    const part = await makePart();
    const meRow = await readJson(await postAs("me", { partId: part.id, quantity: 3 }), ownedPartSchema);

    const patchRes = await patchAs("alice", meRow.id, { quantity: 9 });
    expect(patchRes.status).toBe(404);
    expect(await readJson(patchRes, notFoundSchema)).toEqual({ error: "not found" });

    const deleteRes = await deleteAs("alice", meRow.id);
    expect(deleteRes.status).toBe(404);
    expect(await readJson(deleteRes, notFoundSchema)).toEqual({ error: "not found" });

    expect(await rowsForAs("me", part.id)).toEqual([meRow]);
  });

  it("answers 404 not found for an unknown id, as me", async () => {
    const ids = (await listAs("me")).map((row) => row.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await patchAs("me", unknown, { quantity: 4 });
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });

  it("lets alice delete her own row, which then leaves her list", async () => {
    const part = await makePart();
    const aliceRow = await readJson(await postAs("alice", { partId: part.id, quantity: 2 }), ownedPartSchema);

    const res = await deleteAs("alice", aliceRow.id);
    expect(res.status).toBe(204);
    expect(await rowsForAs("alice", part.id)).toEqual([]);
  });
});
