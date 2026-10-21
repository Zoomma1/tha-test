import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { SEED_BUILD } from "../src/seed-data.js";
import { authed, get, partSchema, readJson } from "./helpers.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  parts: z.array(partSchema),
});

const listSchema = z.array(buildSchema);
const catalogueSchema = z.array(partSchema);

// Chaque test supprime les builds qu'il crée : la base test.db est partagée.
const createdBuildIds: number[] = [];

async function createBuild(name: string): Promise<number> {
  const build = await db.build.create({ data: { name } });
  createdBuildIds.push(build.id);
  return build.id;
}

afterEach(async () => {
  const ids = createdBuildIds.splice(0);
  await db.build.deleteMany({ where: { id: { in: ids } } });
});

describe("GET /api/builds", () => {
  it("returns 200 with a body that matches the output schema", async () => {
    const res = await authed("/api/builds");
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect(body.length).toBeGreaterThan(0);
  });

  it("lists the seeded build with its three parts", async () => {
    const body = await readJson(await authed("/api/builds"), listSchema);
    const seeded = body.filter((build) => build.name === SEED_BUILD.name);
    expect(seeded).toHaveLength(1);
    const names = seeded[0]?.parts.map((part) => part.name) ?? [];
    expect([...names].sort()).toEqual([...SEED_BUILD.partNames].sort());
  });

  it("gives each part of a build the id, kind and name the catalogue has for it", async () => {
    const catalogue = await readJson(await get("/api/parts"), catalogueSchema);
    const body = await readJson(await authed("/api/builds"), listSchema);
    const parts = body.flatMap((build) => build.parts);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part).toEqual(catalogue.find((entry) => entry.id === part.id));
    }
  });

  it("returns parts: [] for a build without parts", async () => {
    const id = await createBuild("Build sans pièce");
    const body = await readJson(await authed("/api/builds"), listSchema);
    const found = body.find((build) => build.id === id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Build sans pièce");
    expect(found?.parts).toEqual([]);
  });

  it("orders builds by id, ascending", async () => {
    const first = await createBuild("Premier build de test");
    const second = await createBuild("Second build de test");
    const body = await readJson(await authed("/api/builds"), listSchema);
    const ids = body.map((build) => build.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });
});
