import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { SEED_BUILD } from "../src/seed-data.js";
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

const kinds: Kind[] = ["blade", "ratchet", "bit"];

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

async function addPart(buildId: number, partId: number): Promise<Response> {
  return app.request(`/api/builds/${String(buildId)}/parts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partId }),
  });
}

async function listedBuild(buildId: number): Promise<z.output<typeof buildSchema> | undefined> {
  const body = await readJson(await get("/api/builds"), listSchema);
  return body.find((build) => build.id === buildId);
}

function byId(a: { id: number }, b: { id: number }): number {
  return a.id - b.id;
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("POST /api/builds/:id/parts: ajout (201)", () => {
  it("adds the part and returns the full build with 201", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    const res = await addPart(build.id, part.id);
    expect(res.status).toBe(201);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: build.id, name: build.name, parts: [part] });
  });

  it("returns the same build that the list shows afterwards", async () => {
    const build = await makeBuild();
    const part = await makePart("ratchet");
    const body = await readJson(await addPart(build.id, part.id), buildSchema);
    expect(await listedBuild(build.id)).toEqual(body);
  });

  it("accepts one part of each kind in the same build", async () => {
    const build = await makeBuild();
    const parts = [await makePart("blade"), await makePart("ratchet"), await makePart("bit")];
    for (const part of parts) {
      expect((await addPart(build.id, part.id)).status).toBe(201);
    }
    const listed = await listedBuild(build.id);
    expect([...(listed?.parts ?? [])].sort(byId)).toEqual([...parts].sort(byId));
  });

  it("lets the same part serve in several builds", async () => {
    const first = await makeBuild();
    const second = await makeBuild();
    const part = await makePart("bit");
    expect((await addPart(first.id, part.id)).status).toBe(201);

    const res = await addPart(second.id, part.id);
    expect(res.status).toBe(201);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: second.id, name: second.name, parts: [part] });
    expect((await listedBuild(first.id))?.parts).toEqual([part]);
  });
});

describe("POST /api/builds/:id/parts: erreurs 404", () => {
  it("returns 404 with an error for an unknown build, and attaches nothing", async () => {
    const part = await makePart("blade");
    const gone = await makeBuild();
    await db.build.delete({ where: { id: gone.id } });

    const res = await addPart(gone.id, part.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();

    const listed = await readJson(await get("/api/builds"), listSchema);
    expect(listed.some((build) => build.parts.some((p) => p.id === part.id))).toBe(false);
  });

  it("returns 404 with an error for an unknown part, and leaves the build unchanged", async () => {
    const build = await makeBuild();
    const gone = await makePart("ratchet");
    await db.part.delete({ where: { id: gone.id } });

    const res = await addPart(build.id, gone.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listedBuild(build.id))?.parts).toEqual([]);
  });
});

describe("POST /api/builds/:id/parts: emplacement déjà pris (409)", () => {
  it.each(kinds)("returns 409 'slot taken' when the build already has a %s", async (kind) => {
    const build = await makeBuild();
    const first = await makePart(kind);
    const second = await makePart(kind);
    expect((await addPart(build.id, first.id)).status).toBe(201);

    const res = await addPart(build.id, second.id);
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBe("slot taken");
    expect((await listedBuild(build.id))?.parts).toEqual([first]);
  });

  it("refuses the same part a second time, and keeps a single copy", async () => {
    const build = await makeBuild();
    const part = await makePart("blade");
    expect((await addPart(build.id, part.id)).status).toBe(201);

    const res = await addPart(build.id, part.id);
    expect(res.status).toBe(409);
    await readJson(res, errorSchema);
    expect((await listedBuild(build.id))?.parts).toEqual([part]);
  });

  it("refuses a second blade on the seeded build, which already has one", async () => {
    const seeded = (await readJson(await get("/api/builds"), listSchema)).find(
      (build) => build.name === SEED_BUILD.name,
    );
    if (seeded === undefined) throw new Error("le build seedé est introuvable");
    const part = await makePart("blade");

    const res = await addPart(seeded.id, part.id);
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBe("slot taken");
    expect((await listedBuild(seeded.id))?.parts).toEqual(seeded.parts);
  });
});
