import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { SEED_BUILD } from "../src/seed-data.js";
import { authed, readJson } from "./helpers.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  notes: z.string().nullable(),
  parts: z.array(z.object({ id: z.number(), kind: z.string(), name: z.string() })),
});

const listSchema = z.array(buildSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function postBuildRaw(body: string): Promise<Response> {
  return authed("/api/builds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function postBuild(body: unknown): Promise<Response> {
  return postBuildRaw(JSON.stringify(body));
}

// Chaque build créé avec succès est noté puis supprimé : la base test.db est partagée.
const createdBuildIds: number[] = [];

async function postCreated(body: unknown): Promise<Response> {
  const res = await postBuild(body);
  if (res.status === 201) {
    const created = await readJson(res.clone(), buildSchema);
    createdBuildIds.push(created.id);
  }
  return res;
}

afterEach(async () => {
  const ids = createdBuildIds.splice(0);
  await db.build.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/builds: création (201)", () => {
  it("creates an empty build and returns it with 201", async () => {
    const name = `Build de test ${randomUUID()}`;
    const res = await postCreated({ name });
    expect(res.status).toBe(201);
    const body = await readJson(res, buildSchema);
    expect(body.name).toBe(name);
    expect(body.parts).toEqual([]);
    expect(typeof body.id).toBe("number");
  });

  it("lists the new build with no parts", async () => {
    const name = `Build listé ${randomUUID()}`;
    const created = await readJson(await postCreated({ name }), buildSchema);
    const listed = (await readJson(await authed("/api/builds"), listSchema)).find((b) => b.id === created.id);
    expect(listed).toEqual({ id: created.id, name, notes: null, parts: [] });
  });

  it("trims the name before storing and returning it", async () => {
    const name = `Build rogné ${randomUUID()}`;
    const res = await postCreated({ name: `   ${name}  \t` });
    expect(res.status).toBe(201);
    const body = await readJson(res, buildSchema);
    expect(body.name).toBe(name);
  });
});

describe("POST /api/builds: nom vide (400)", () => {
  it.each(["", "   ", "\t \n"])("returns 400 with an error for the blank name %j", async (name) => {
    const res = await postCreated({ name });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when the name is missing", async () => {
    const res = await postCreated({});
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("returns 400 when the name is not a string", async () => {
    const res = await postCreated({ name: 42 });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("returns 400 when the body is not JSON", async () => {
    const res = await postBuildRaw("pas du json");
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("creates no build for an invalid name", async () => {
    const before = (await readJson(await authed("/api/builds"), listSchema)).length;
    await postCreated({ name: "   " });
    const after = (await readJson(await authed("/api/builds"), listSchema)).length;
    expect(after).toBe(before);
  });
});

describe("POST /api/builds: nom déjà pris (409)", () => {
  it("refuses a name that exists in the seed, whatever the case, with 409", async () => {
    const res = await postCreated({ name: SEED_BUILD.name.toUpperCase() });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("refuses a name that only differs by case from a build created before", async () => {
    const name = `Build Casse ${randomUUID()}`;
    expect((await postCreated({ name })).status).toBe(201);

    const res = await postCreated({ name: name.toLowerCase() });
    expect(res.status).toBe(409);
    await readJson(res, errorSchema);
  });

  it("compares the trimmed name, so surrounding spaces do not make a new name", async () => {
    const name = `Build Espaces ${randomUUID()}`;
    expect((await postCreated({ name })).status).toBe(201);

    const res = await postCreated({ name: `  ${name.toUpperCase()}  ` });
    expect(res.status).toBe(409);
    await readJson(res, errorSchema);
  });

  it("keeps a single build with that name after a refused duplicate", async () => {
    const name = `Build Unique ${randomUUID()}`;
    await postCreated({ name });
    await postCreated({ name: name.toUpperCase() });

    const matching = (await readJson(await authed("/api/builds"), listSchema)).filter(
      (b) => b.name.toLowerCase() === name.toLowerCase(),
    );
    expect(matching).toHaveLength(1);
  });
});
