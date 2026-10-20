import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { get, partSchema, readJson } from "./helpers.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  parts: z.array(partSchema),
});

const listSchema = z.array(buildSchema);
const errorSchema = z.object({ error: z.string().min(1) });

type Kind = "blade" | "ratchet" | "bit";
type TestPart = { id: number; kind: Kind; name: string };

// Chaque test crée ses propres builds et pièces, puis les supprime : la base test.db est partagée.
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

// Mise en place uniquement : la pièce est déjà dans le build avant la suppression testée.
async function attach(buildId: number, partId: number): Promise<void> {
  await db.buildPart.create({ data: { buildId, partId } });
}

async function deleteBuild(id: number): Promise<Response> {
  return app.request(`/api/builds/${String(id)}`, { method: "DELETE" });
}

async function listBuilds(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/builds"), listSchema);
}

async function listedBuild(buildId: number): Promise<z.output<typeof buildSchema> | undefined> {
  return (await listBuilds()).find((build) => build.id === buildId);
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("DELETE /api/builds/:id: suppression (204)", () => {
  it("returns 204 with no body for an empty build", async () => {
    const build = await makeBuild();

    const res = await deleteBuild(build.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("the build is gone from GET /api/builds and the other builds stay", async () => {
    const removed = await makeBuild();
    const kept = await makeBuild();

    expect((await deleteBuild(removed.id)).status).toBe(204);

    expect(await listedBuild(removed.id)).toBeUndefined();
    expect(await listedBuild(kept.id)).toEqual({ id: kept.id, name: kept.name, parts: [] });
  });

  it("deletes a build that holds parts without a foreign key error", async () => {
    const build = await makeBuild();
    const blade = await makePart("blade");
    const ratchet = await makePart("ratchet");
    const bit = await makePart("bit");
    await attach(build.id, blade.id);
    await attach(build.id, ratchet.id);
    await attach(build.id, bit.id);

    const res = await deleteBuild(build.id);
    expect(res.status).toBe(204);
    expect(await listedBuild(build.id)).toBeUndefined();
  });

  it("does not delete the parts of the build", async () => {
    const build = await makeBuild();
    const blade = await makePart("blade");
    const bit = await makePart("bit");
    await attach(build.id, blade.id);
    await attach(build.id, bit.id);

    expect((await deleteBuild(build.id)).status).toBe(204);

    for (const part of [blade, bit]) {
      const res = await get(`/api/parts/${String(part.id)}`);
      expect(res.status).toBe(200);
      expect(await readJson(res, partSchema)).toEqual(part);
    }
  });

  it("keeps a part that another build still holds", async () => {
    const removed = await makeBuild();
    const other = await makeBuild();
    const part = await makePart("bit");
    await attach(removed.id, part.id);
    await attach(other.id, part.id);

    expect((await deleteBuild(removed.id)).status).toBe(204);

    expect(await listedBuild(removed.id)).toBeUndefined();
    expect(await listedBuild(other.id)).toEqual({ id: other.id, name: other.name, parts: [part] });
  });

  it("a deleted build cannot be targeted anymore", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    await attach(build.id, part.id);
    expect((await deleteBuild(build.id)).status).toBe(204);

    const res = await app.request(`/api/builds/${String(build.id)}/parts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId: part.id }),
    });
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
  });
});

describe("DELETE /api/builds/:id: id inconnu (404)", () => {
  it("returns 404 with an error for an id that does not exist", async () => {
    const ids = (await listBuilds()).map((build) => build.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await deleteBuild(unknown);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 404 the second time the same build is deleted, and the list is unchanged", async () => {
    const build = await makeBuild();
    expect((await deleteBuild(build.id)).status).toBe(204);
    const before = (await listBuilds()).map((b) => b.id);

    const res = await deleteBuild(build.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listBuilds()).map((b) => b.id)).toEqual(before);
  });

  it("returns 404 and leaves the parts of an unknown build in place", async () => {
    const part = await makePart("ratchet");
    const gone = await makeBuild();
    await attach(gone.id, part.id);
    expect((await deleteBuild(gone.id)).status).toBe(204);

    const res = await deleteBuild(gone.id);
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
    expect((await get(`/api/parts/${String(part.id)}`)).status).toBe(200);
  });
});
