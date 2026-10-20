import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { get, partSchema, readJson } from "./helpers.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  priority: z.number(),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);
const errorSchema = z.object({ error: z.string().min(1) });

type Kind = "blade" | "ratchet" | "bit";

// Chaque test crée ses propres builds et pièces (et ses lignes d'inventaire ou de liste), puis les supprime : test.db est partagée.
const createdBuildIds: number[] = [];
const createdPartIds: number[] = [];

async function makeBuild(): Promise<{ id: number }> {
  const build = await db.build.create({ data: { name: `Build de test ${randomUUID()}` } });
  createdBuildIds.push(build.id);
  return { id: build.id };
}

async function makePart(kind: Kind): Promise<{ id: number; kind: Kind; name: string }> {
  const part = await db.part.create({ data: { kind, name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id, kind, name: part.name };
}

// Mise en place uniquement : la pièce est dans le build avant l'appel testé.
async function attach(buildId: number, partId: number): Promise<void> {
  await db.buildPart.create({ data: { buildId, partId } });
}

// Mise en place uniquement : la pièce est possédée avant l'appel testé.
async function own(partId: number): Promise<void> {
  await db.ownedPart.create({ data: { partId, quantity: 1 } });
}

async function fromBuild(buildId: number): Promise<Response> {
  return app.request(`/api/wishlist/from-build/${String(buildId)}`, { method: "POST" });
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await readJson(await get("/api/wishlist"), listSchema);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.wishlistItem.deleteMany({ where: { partId: { in: partIds } } });
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("POST /api/wishlist/from-build/:buildId: ajout (201)", () => {
  it("adds the build's parts that are neither owned nor listed, and returns them with 201", async () => {
    const build = await makeBuild();
    const parts = [await makePart("blade"), await makePart("ratchet"), await makePart("bit")];
    for (const part of parts) await attach(build.id, part.id);

    const res = await fromBuild(build.id);
    expect(res.status).toBe(201);
    const body = await readJson(res, listSchema);
    expect(body.map((item) => item.part).sort((a, b) => a.id - b.id)).toEqual([...parts].sort((a, b) => a.id - b.id));
    for (const part of parts) {
      expect(await rowsFor(part.id)).toEqual(body.filter((item) => item.partId === part.id));
    }
  });

  it("leaves out the parts the user already owns", async () => {
    const build = await makeBuild();
    const owned = await makePart("blade");
    const missing = await makePart("ratchet");
    await own(owned.id);
    await attach(build.id, owned.id);
    await attach(build.id, missing.id);

    const res = await fromBuild(build.id);
    expect(res.status).toBe(201);
    const body = await readJson(res, listSchema);
    expect(body.map((item) => item.partId)).toEqual([missing.id]);
    expect(await rowsFor(owned.id)).toEqual([]);
  });

  it("leaves out the parts already in the wishlist, and does not touch their item", async () => {
    const build = await makeBuild();
    const listed = await makePart("bit");
    const missing = await makePart("blade");
    await db.wishlistItem.create({ data: { partId: listed.id, note: "déjà là" } });
    await attach(build.id, listed.id);
    await attach(build.id, missing.id);

    const res = await fromBuild(build.id);
    expect(res.status).toBe(201);
    const body = await readJson(res, listSchema);
    expect(body.map((item) => item.partId)).toEqual([missing.id]);
    expect((await rowsFor(listed.id)).map((row) => row.note)).toEqual(["déjà là"]);
  });

  it("returns 201 with an empty list when every part is owned or already listed", async () => {
    const build = await makeBuild();
    const owned = await makePart("blade");
    const listed = await makePart("ratchet");
    await own(owned.id);
    await db.wishlistItem.create({ data: { partId: listed.id, note: "" } });
    await attach(build.id, owned.id);
    await attach(build.id, listed.id);

    const res = await fromBuild(build.id);
    expect(res.status).toBe(201);
    expect(await readJson(res, listSchema)).toEqual([]);
    expect(await rowsFor(owned.id)).toEqual([]);
    expect(await rowsFor(listed.id)).toHaveLength(1);
  });

  it("returns 201 with an empty list for a build without parts", async () => {
    const build = await makeBuild();

    const res = await fromBuild(build.id);
    expect(res.status).toBe(201);
    expect(await readJson(res, listSchema)).toEqual([]);
  });

  it("adds nothing more when the same call is replayed", async () => {
    const build = await makeBuild();
    const parts = [await makePart("ratchet"), await makePart("bit")];
    for (const part of parts) await attach(build.id, part.id);

    const first = await readJson(await fromBuild(build.id), listSchema);
    expect(first).toHaveLength(parts.length);

    const replay = await fromBuild(build.id);
    expect(replay.status).toBe(201);
    expect(await readJson(replay, listSchema)).toEqual([]);
    for (const part of parts) {
      expect(await rowsFor(part.id)).toEqual(first.filter((item) => item.partId === part.id));
    }
  });
});

describe("POST /api/wishlist/from-build/:buildId: build inconnu (404)", () => {
  it("returns 404 with an error for an unknown build, and adds nothing", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    await attach(build.id, part.id);
    await db.buildPart.deleteMany({ where: { buildId: build.id } });
    await db.build.delete({ where: { id: build.id } });

    const res = await fromBuild(build.id);
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
    expect(await rowsFor(part.id)).toEqual([]);
  });
});
