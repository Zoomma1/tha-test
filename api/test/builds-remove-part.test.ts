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

// Mise en place uniquement : la pièce est déjà dans le build avant le retrait testé.
async function attach(buildId: number, partId: number): Promise<void> {
  await db.buildPart.create({ data: { buildId, partId } });
}

async function removePart(buildId: number, partId: number): Promise<Response> {
  return app.request(`/api/builds/${String(buildId)}/parts/${String(partId)}`, { method: "DELETE" });
}

async function listedBuild(buildId: number): Promise<z.output<typeof buildSchema> | undefined> {
  const body = await readJson(await get("/api/builds"), listSchema);
  return body.find((build) => build.id === buildId);
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("DELETE /api/builds/:id/parts/:partId: retrait (204)", () => {
  it("returns 204 with no body and the part is no longer in the build", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    await attach(build.id, part.id);

    const res = await removePart(build.id, part.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect((await listedBuild(build.id))?.parts).toEqual([]);
  });

  it("removes only that part and keeps the other parts of the build", async () => {
    const build = await makeBuild();
    const blade = await makePart("blade");
    const ratchet = await makePart("ratchet");
    const bit = await makePart("bit");
    await attach(build.id, blade.id);
    await attach(build.id, ratchet.id);
    await attach(build.id, bit.id);

    expect((await removePart(build.id, ratchet.id)).status).toBe(204);
    expect((await listedBuild(build.id))?.parts).toEqual([blade, bit]);
  });

  it("keeps the same part in another build", async () => {
    const first = await makeBuild();
    const second = await makeBuild();
    const part = await makePart("bit");
    await attach(first.id, part.id);
    await attach(second.id, part.id);

    expect((await removePart(first.id, part.id)).status).toBe(204);
    expect((await listedBuild(first.id))?.parts).toEqual([]);
    expect((await listedBuild(second.id))?.parts).toEqual([part]);
  });
});

describe("DELETE /api/builds/:id/parts/:partId: erreurs 404", () => {
  it("returns 404 with an error for an unknown build", async () => {
    const part = await makePart("blade");
    const gone = await makeBuild();
    await db.build.delete({ where: { id: gone.id } });

    const res = await removePart(gone.id, part.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 404 with an error when the part is not in this build, and leaves the build unchanged", async () => {
    const build = await makeBuild();
    const kept = await makePart("ratchet");
    const notIn = await makePart("blade");
    await attach(build.id, kept.id);

    const res = await removePart(build.id, notIn.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listedBuild(build.id))?.parts).toEqual([kept]);
  });

  it("returns 404 when the part is in another build, and does not remove it from there", async () => {
    const owner = await makeBuild();
    const other = await makeBuild();
    const part = await makePart("bit");
    await attach(owner.id, part.id);

    const res = await removePart(other.id, part.id);
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
    expect((await listedBuild(owner.id))?.parts).toEqual([part]);
  });

  it("returns 404 the second time the same part is removed", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    await attach(build.id, part.id);
    expect((await removePart(build.id, part.id)).status).toBe(204);

    const res = await removePart(build.id, part.id);
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
    expect((await listedBuild(build.id))?.parts).toEqual([]);
  });
});
