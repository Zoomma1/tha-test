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
  notes: z.string().nullable(),
  parts: z.array(partSchema),
});

const listSchema = z.array(buildSchema);
const errorSchema = z.object({ error: z.string().min(1) });
const columnsSchema = z.array(z.object({ name: z.string(), type: z.string(), notnull: z.coerce.number() }));

type Kind = "blade" | "ratchet" | "bit";
type TestPart = { id: number; kind: Kind; name: string };

function byId(a: { id: number }, b: { id: number }): number {
  return a.id - b.id;
}

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

// Mise en place uniquement : la pièce est déjà dans le build avant la modification testée.
async function attach(buildId: number, partId: number): Promise<void> {
  await db.buildPart.create({ data: { buildId, partId } });
}

async function patchRaw(id: number, body: string): Promise<Response> {
  return app.request(`/api/builds/${String(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function patchBuild(id: number, body: unknown): Promise<Response> {
  return patchRaw(id, JSON.stringify(body));
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

describe("PATCH /api/builds/:id: notes (200)", () => {
  it("sets the notes and returns the full build with 200", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { notes: "Build défensive" });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: build.id, name: build.name, notes: "Build défensive", parts: [] });
  });

  it("the list shows the notes that the PATCH returned", async () => {
    const build = await makeBuild();
    const body = await readJson(await patchBuild(build.id, { notes: "À tester en attaque" }), buildSchema);
    expect(await listedBuild(build.id)).toEqual(body);
  });

  it("accepts notes of exactly 500 characters", async () => {
    const build = await makeBuild();
    const notes = "a".repeat(500);
    const res = await patchBuild(build.id, { notes });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body.notes).toBe(notes);
  });

  it("keeps the parts of the build when only the notes change", async () => {
    const build = await makeBuild();
    const blade = await makePart("blade");
    const bit = await makePart("bit");
    await attach(build.id, blade.id);
    await attach(build.id, bit.id);

    const res = await patchBuild(build.id, { notes: "Garde les pièces" });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect([...body.parts].sort(byId)).toEqual([blade, bit].sort(byId));
  });
});

describe("PATCH /api/builds/:id: nom (200)", () => {
  it("renames the build and returns it with 200", async () => {
    const build = await makeBuild();
    const name = `Build renommé ${randomUUID()}`;
    const res = await patchBuild(build.id, { name });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: build.id, name, notes: null, parts: [] });
  });

  it("trims the new name before storing and returning it", async () => {
    const build = await makeBuild();
    const name = `Build rogné ${randomUUID()}`;
    const res = await patchBuild(build.id, { name: `   ${name}  \t` });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body.name).toBe(name);
  });

  it("accepts the build's own current name, which is not a conflict", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { name: build.name });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body.name).toBe(build.name);
  });

  it("updates the name and the notes in one request", async () => {
    const build = await makeBuild();
    const name = `Build double ${randomUUID()}`;
    const res = await patchBuild(build.id, { name, notes: "Deux champs" });
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: build.id, name, notes: "Deux champs", parts: [] });
  });

  it("keeps the name and the notes when the body is empty", async () => {
    const build = await makeBuild();
    await patchBuild(build.id, { notes: "Inchangées" });

    const res = await patchBuild(build.id, {});
    expect(res.status).toBe(200);
    const body = await readJson(res, buildSchema);
    expect(body).toEqual({ id: build.id, name: build.name, notes: "Inchangées", parts: [] });
  });
});

describe("PATCH /api/builds/:id: id inconnu (404)", () => {
  it("returns 404 with an error for an id that does not exist", async () => {
    const ids = (await listBuilds()).map((build) => build.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await patchBuild(unknown, { name: `Inconnu ${randomUUID()}` });
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("does not create a build for an unknown id", async () => {
    const before = (await listBuilds()).map((build) => build.id);
    const unknown = Math.max(0, ...before) + 1;

    expect((await patchBuild(unknown, { notes: "Fantôme" })).status).toBe(404);
    expect((await listBuilds()).map((build) => build.id)).toEqual(before);
  });
});

describe("PATCH /api/builds/:id: entrée invalide (400)", () => {
  it("returns 400 with an error for notes longer than 500 characters", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { notes: "a".repeat(501) });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listedBuild(build.id))?.notes).toBeNull();
  });

  it("returns 400 when the notes are not a string", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { notes: 42 });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it.each(["", "   ", "\t \n"])("returns 400 for the blank name %j and keeps the name", async (name) => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { name });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
    expect((await listedBuild(build.id))?.name).toBe(build.name);
  });

  it("returns 400 when the name is not a string", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { name: 42 });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("returns 400 when the body is not JSON", async () => {
    const build = await makeBuild();
    const res = await patchRaw(build.id, "pas du json");
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("applies nothing when one field of the body is invalid", async () => {
    const build = await makeBuild();
    const res = await patchBuild(build.id, { name: `Ne doit pas passer ${randomUUID()}`, notes: "a".repeat(501) });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);

    const listed = await listedBuild(build.id);
    expect(listed?.name).toBe(build.name);
    expect(listed?.notes).toBeNull();
  });
});

describe("PATCH /api/builds/:id: nom déjà pris (409)", () => {
  it("refuses a name held by another build, whatever the case, with 409", async () => {
    const other = await makeBuild();
    const build = await makeBuild();

    const res = await patchBuild(build.id, { name: other.name.toUpperCase() });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listedBuild(build.id))?.name).toBe(build.name);
  });

  it("refuses the name of the seeded build, whatever the case, with 409", async () => {
    const build = await makeBuild();

    const res = await patchBuild(build.id, { name: SEED_BUILD.name.toLowerCase() });
    expect(res.status).toBe(409);
    await readJson(res, errorSchema);
    expect((await listedBuild(build.id))?.name).toBe(build.name);
  });

  it("compares the trimmed name, so surrounding spaces do not make a new name", async () => {
    const other = await makeBuild();
    const build = await makeBuild();

    const res = await patchBuild(build.id, { name: `  ${other.name.toLowerCase()}  ` });
    expect(res.status).toBe(409);
    await readJson(res, errorSchema);
  });
});

describe("PATCH /api/builds: seed et migration", () => {
  it("the seeded build has notes: null", async () => {
    const seeded = (await listBuilds()).find((build) => build.name === SEED_BUILD.name);
    expect(seeded?.notes).toBeNull();
  });

  it("the Build table has a nullable notes column, added by the migrations", async () => {
    const rows = await db.$queryRaw`SELECT name, type, "notnull" FROM pragma_table_info('Build')`;
    const columns = columnsSchema.parse(rows);
    expect(columns.find((column) => column.name === "notes")).toEqual({
      name: "notes",
      type: "TEXT",
      notnull: 0,
    });
  });
});
