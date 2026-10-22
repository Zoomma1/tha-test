import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { authed, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);
const errorSchema = z.object({ error: z.string().min(1) });

type Kind = "blade" | "ratchet" | "bit";
type TestPart = { id: number; kind: Kind; name: string };

// Chaque test crée ses propres builds, pièces et lignes d'inventaire, puis les supprime : la base test.db est partagée.
const createdBuildIds: number[] = [];
const createdPartIds: number[] = [];

async function makeBuild(): Promise<{ id: number; name: string }> {
  const build = await db.build.create({ data: { name: `Build de test ${randomUUID()}` } });
  createdBuildIds.push(build.id);
  return { id: build.id, name: build.name };
}

async function makePart(kind: Kind): Promise<TestPart> {
  const part = await db.part.create({ data: { kind, name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id, kind, name: part.name };
}

async function addPart(buildId: number, partId: number): Promise<Response> {
  return authed(`/api/builds/${String(buildId)}/parts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partId }),
  });
}

async function own(partId: number): Promise<void> {
  const res = await authed("/api/owned-parts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partId, quantity: 1 }),
  });
  expect(res.status).toBe(201);
}

// Un build avec une lame, un ratchet et un bit ; les pièces passées à `owned` sont dans l'inventaire.
async function makeFullBuild(owned: { blade?: boolean; ratchet?: boolean; bit?: boolean }): Promise<{
  buildId: number;
  blade: TestPart;
  ratchet: TestPart;
  bit: TestPart;
}> {
  const build = await makeBuild();
  const blade = await makePart("blade");
  const ratchet = await makePart("ratchet");
  const bit = await makePart("bit");
  for (const part of [blade, ratchet, bit]) {
    expect((await addPart(build.id, part.id)).status).toBe(201);
  }
  if (owned.blade === true) await own(blade.id);
  if (owned.ratchet === true) await own(ratchet.id);
  if (owned.bit === true) await own(bit.id);
  return { buildId: build.id, blade, ratchet, bit };
}

async function missingOf(buildId: number): Promise<Response> {
  return authed(`/api/builds/${String(buildId)}/missing`);
}

function byId(a: { id: number }, b: { id: number }): number {
  return a.id - b.id;
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("GET /api/builds/:id/missing: pièces absentes de l'inventaire (200)", () => {
  it("lists the build parts that are not in the inventory, with id, kind and name", async () => {
    const { buildId, blade, ratchet, bit } = await makeFullBuild({ blade: true });
    const res = await missingOf(buildId);
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect([...body].sort(byId)).toEqual([ratchet, bit].sort(byId));
    expect(body.map((p) => p.id)).not.toContain(blade.id);
  });

  it("returns an empty list when every part of the build is owned", async () => {
    const { buildId } = await makeFullBuild({ blade: true, ratchet: true, bit: true });
    const res = await missingOf(buildId);
    expect(res.status).toBe(200);
    expect(await readJson(res, listSchema)).toEqual([]);
  });

  it("returns an empty list for a build without parts", async () => {
    const build = await makeBuild();
    const res = await missingOf(build.id);
    expect(res.status).toBe(200);
    expect(await readJson(res, listSchema)).toEqual([]);
  });

  it("stops listing a part once it has been added to the inventory", async () => {
    const { buildId, blade, ratchet, bit } = await makeFullBuild({});
    const before = await readJson(await missingOf(buildId), listSchema);
    expect([...before].sort(byId)).toEqual([blade, ratchet, bit].sort(byId));

    await own(ratchet.id);
    const after = await readJson(await missingOf(buildId), listSchema);
    expect([...after].sort(byId)).toEqual([blade, bit].sort(byId));
  });

  it("does not mix in the missing parts of another build", async () => {
    const owner = await makeFullBuild({ blade: true, ratchet: true, bit: true });
    const other = await makeFullBuild({});
    expect(await readJson(await missingOf(owner.buildId), listSchema)).toEqual([]);
    expect(await readJson(await missingOf(other.buildId), listSchema)).toHaveLength(3);
  });
});

describe("GET /api/builds/:id/missing: build inconnu (404)", () => {
  it("returns 404 with an error for a build that does not exist", async () => {
    const gone = await makeBuild();
    await db.build.delete({ where: { id: gone.id } });

    const res = await missingOf(gone.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 404 with an error for a build id that is not a number", async () => {
    const res = await authed("/api/builds/abc/missing");
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });
});
