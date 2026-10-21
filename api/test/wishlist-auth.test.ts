import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { SEED_WISHLIST } from "../src/seed-data.js";
import { authed, get, partSchema, readJson } from "./helpers.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);
const unauthorizedSchema = z.strictObject({ error: z.literal("unauthorized") });
const notFoundSchema = z.strictObject({ error: z.literal("not found") });
const errorSchema = z.object({ error: z.string().min(1) });

// Jeton bien formé (32 octets en base64url, 43 caractères) mais inconnu de la base.
const UNKNOWN_SESSION = `session=${"A".repeat(43)}`;

// Chaque test crée ses pièces et ses builds (et leurs lignes de liste ou d'inventaire), puis les supprime : test.db est partagée.
const createdPartIds: number[] = [];
const createdBuildIds: number[] = [];

async function userIdOf(handle: string): Promise<number> {
  const user = await db.user.findUniqueOrThrow({ where: { handle } });
  return user.id;
}

async function makePart(): Promise<{ id: number }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id };
}

// Mise en place uniquement : un build appartenant à l'utilisateur donné.
async function makeBuildFor(handle: string): Promise<number> {
  const ownerId = await userIdOf(handle);
  const build = await db.build.create({ data: { name: `Build de test ${randomUUID()}`, ownerId } });
  createdBuildIds.push(build.id);
  return build.id;
}

// Mise en place uniquement : la pièce est dans le build avant l'appel testé.
async function attach(buildId: number, partId: number): Promise<void> {
  await db.buildPart.create({ data: { buildId, partId } });
}

async function postAs(as: string, body: unknown): Promise<Response> {
  return authed("/api/wishlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, as);
}

async function deleteAs(as: string, id: number): Promise<Response> {
  return authed(`/api/wishlist/${String(id)}`, { method: "DELETE" }, as);
}

async function fromBuildAs(as: string, buildId: number): Promise<Response> {
  return authed(`/api/wishlist/from-build/${String(buildId)}`, { method: "POST" }, as);
}

async function listAs(as: string): Promise<z.output<typeof listSchema>> {
  return readJson(await authed("/api/wishlist", {}, as), listSchema);
}

async function rowsFor(partId: number, as: string): Promise<z.output<typeof listSchema>> {
  const body = await listAs(as);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const partIds = createdPartIds.splice(0);
  const buildIds = createdBuildIds.splice(0);
  await db.wishlistItem.deleteMany({ where: { partId: { in: partIds } } });
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("sans cookie : 401 sur chaque route", () => {
  it("GET /api/wishlist answers 401 unauthorized", async () => {
    const res = await get("/api/wishlist");
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });

  it("POST /api/wishlist answers 401 and creates no item", async () => {
    const part = await makePart();
    const res = await app.request("/api/wishlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId: part.id, note: "sans cookie" }),
    });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([]);
  });

  it("POST /api/wishlist/from-build/:buildId answers 401 and adds nothing", async () => {
    const buildId = await makeBuildFor("me");
    const part = await makePart();
    await attach(buildId, part.id);

    const res = await app.request(`/api/wishlist/from-build/${String(buildId)}`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([]);
  });

  it("DELETE /api/wishlist/:id answers 401 and keeps the item", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id }), wishlistItemSchema);

    const res = await app.request(`/api/wishlist/${String(created.id)}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
    expect(await rowsFor(part.id, "me")).toEqual([created]);
  });

  it("answers 401 unauthorized for a session token the database does not know", async () => {
    const res = await app.request("/api/wishlist", { headers: { cookie: UNKNOWN_SESSION } });
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });
});

describe("isolation : chaque utilisateur ne voit et ne touche que sa liste", () => {
  it("an item added by alice does not appear in me's list", async () => {
    const part = await makePart();
    const res = await postAs("alice", { partId: part.id, note: "pour alice" });
    expect(res.status).toBe(201);
    const created = await readJson(res, wishlistItemSchema);

    expect(await rowsFor(part.id, "alice")).toEqual([created]);
    expect(await rowsFor(part.id, "me")).toEqual([]);
    expect((await listAs("me")).map((row) => row.id)).not.toContain(created.id);
  });

  it("does not show me's seeded rows in alice's list", async () => {
    const aliceRows = await listAs("alice");
    for (const seed of SEED_WISHLIST) {
      expect(aliceRows.find((row) => row.part.name === seed.partName)).toBeUndefined();
    }
  });

  it("judges the duplicate per user: the same part can be on both lists, and a second add by alice gives 409", async () => {
    const part = await makePart();
    expect((await postAs("alice", { partId: part.id })).status).toBe(201);
    expect((await postAs("me", { partId: part.id })).status).toBe(201);

    const again = await postAs("alice", { partId: part.id });
    expect(again.status).toBe(409);
    await readJson(again, errorSchema);

    expect(await rowsFor(part.id, "alice")).toHaveLength(1);
    expect(await rowsFor(part.id, "me")).toHaveLength(1);
  });

  it("refuses me to delete alice's item with 404 not found, and alice can still delete it", async () => {
    const part = await makePart();
    const res = await postAs("alice", { partId: part.id });
    expect(res.status).toBe(201);
    const created = await readJson(res, wishlistItemSchema);

    const denied = await deleteAs("me", created.id);
    expect(denied.status).toBe(404);
    expect(await readJson(denied, notFoundSchema)).toEqual({ error: "not found" });
    expect(await rowsFor(part.id, "alice")).toEqual([created]);

    expect((await deleteAs("alice", created.id)).status).toBe(204);
    expect(await rowsFor(part.id, "alice")).toEqual([]);
  });

  it("answers 404 not found when deleting an item that was already deleted", async () => {
    const part = await makePart();
    const created = await readJson(await postAs("me", { partId: part.id }), wishlistItemSchema);
    expect((await deleteAs("me", created.id)).status).toBe(204);

    const res = await deleteAs("me", created.id);
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });
});

describe("POST /api/wishlist/from-build/:buildId : build d'un autre utilisateur", () => {
  it("answers 404 not found for alice's build, and adds nothing to me's list", async () => {
    const aliceBuild = await makeBuildFor("alice");
    const part = await makePart();
    await attach(aliceBuild, part.id);

    const res = await fromBuildAs("me", aliceBuild);
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
    expect(await rowsFor(part.id, "me")).toEqual([]);
    expect(await rowsFor(part.id, "alice")).toEqual([]);
  });

  it("answers 404 not found for a build that does not exist", async () => {
    const build = await makeBuildFor("me");
    await db.build.delete({ where: { id: build } });

    const res = await fromBuildAs("me", build);
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });

  it("adds alice's build parts to alice's list only", async () => {
    const aliceBuild = await makeBuildFor("alice");
    const part = await makePart();
    await attach(aliceBuild, part.id);

    const res = await fromBuildAs("alice", aliceBuild);
    expect(res.status).toBe(201);
    const body = await readJson(res, listSchema);
    expect(body.map((item) => item.partId)).toEqual([part.id]);
    expect(await rowsFor(part.id, "alice")).toEqual(body);
    expect(await rowsFor(part.id, "me")).toEqual([]);
  });

  it("for me's build, adds only the parts neither owned by me nor already in my list", async () => {
    const meId = await userIdOf("me");
    const aliceId = await userIdOf("alice");
    const build = await makeBuildFor("me");
    const ownedByMe = await makePart();
    const ownedByAlice = await makePart();
    const listedByMe = await makePart();
    const listedByAlice = await makePart();
    const missing = await makePart();
    await db.ownedPart.create({ data: { ownerId: meId, partId: ownedByMe.id, quantity: 1 } });
    await db.ownedPart.create({ data: { ownerId: aliceId, partId: ownedByAlice.id, quantity: 1 } });
    await db.wishlistItem.create({ data: { ownerId: meId, partId: listedByMe.id, note: "déjà là" } });
    await db.wishlistItem.create({ data: { ownerId: aliceId, partId: listedByAlice.id, note: "" } });
    for (const part of [ownedByMe, ownedByAlice, listedByMe, listedByAlice, missing]) {
      await attach(build, part.id);
    }

    const res = await fromBuildAs("me", build);
    expect(res.status).toBe(201);
    const body = await readJson(res, listSchema);
    expect(body.map((item) => item.partId).sort((x, y) => x - y)).toEqual(
      [ownedByAlice.id, listedByAlice.id, missing.id].sort((x, y) => x - y),
    );
    expect((await rowsFor(listedByMe.id, "me")).map((row) => row.note)).toEqual(["déjà là"]);
    expect(await rowsFor(ownedByMe.id, "me")).toEqual([]);
  });
});
