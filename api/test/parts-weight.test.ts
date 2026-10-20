import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const partWithWeightSchema = partSchema.extend({ weightGrams: z.number().int().nullable() });
const listWithWeightSchema = z.array(partWithWeightSchema);
const listSchema = z.array(partSchema);

function seedWeight(name: string): number {
  const seed = SEED_PARTS.find((p) => p.name === name);
  if (seed === undefined) throw new Error(`seeded part "${name}" not found`);
  return seed.weightGrams;
}

async function idOf(name: string): Promise<number> {
  const part = (await readJson(await get("/api/parts"), listSchema)).find((p) => p.name === name);
  if (part === undefined) throw new Error(`seeded part "${name}" not found`);
  return part.id;
}

// Pas de route d'écriture : la pièce sans poids est insérée directement, puis supprimée à la fin du test.
async function withWeightlessPart(run: (part: { id: number; name: string }) => Promise<void>): Promise<void> {
  const name = `Weightless Test ${String(Date.now())}`;
  const created = await db.part.create({ data: { kind: "blade", name, weightGrams: null } });
  try {
    await run(created);
  } finally {
    await db.part.delete({ where: { id: created.id } });
  }
}

describe("GET /api/parts exposes weightGrams", () => {
  it.each(SEED_PARTS)("gives $name its seeded weight, not null", async (seed) => {
    const body = await readJson(await get("/api/parts"), listWithWeightSchema);
    const part = body.find((p) => p.name === seed.name);
    expect(part?.weightGrams).toBe(seed.weightGrams);
  });

  it("keeps the kind filter and adds weightGrams to each row", async () => {
    const body = await readJson(await get("/api/parts?kind=blade"), listWithWeightSchema);
    expect(body.every((p) => p.kind === "blade")).toBe(true);
    expect(body.map((p) => p.name).sort()).toEqual(
      SEED_PARTS.filter((p) => p.kind === "blade").map((p) => p.name).sort(),
    );
  });

  it("keeps the search working and returns weightGrams on the match", async () => {
    const body = await readJson(await get("/api/parts?search=dran&kind=blade"), listWithWeightSchema);
    expect(body).toContainEqual(expect.objectContaining({ name: "Dran Sword", weightGrams: 30 }));
  });

  it("returns null, not a missing key, for a part without a weight", async () => {
    await withWeightlessPart(async (part) => {
      const listed = (await readJson(await get("/api/parts"), listWithWeightSchema)).find((p) => p.id === part.id);
      expect(listed).toMatchObject({ id: part.id, name: part.name, weightGrams: null });
    });
  });
});

describe("GET /api/parts/:id exposes weightGrams", () => {
  it.each(["Shark Edge", "4-60", "Ball"])("returns the seeded weight of %s", async (name) => {
    const id = await idOf(name);
    const res = await get(`/api/parts/${String(id)}`);
    expect(res.status).toBe(200);
    const body = await readJson(res, partWithWeightSchema);
    expect(body).toMatchObject({ id, name, weightGrams: seedWeight(name) });
  });

  it("returns null, not a missing key, for a part without a weight", async () => {
    await withWeightlessPart(async (part) => {
      const res = await get(`/api/parts/${String(part.id)}`);
      expect(res.status).toBe(200);
      const body = await readJson(res, partWithWeightSchema);
      expect(body).toMatchObject({ id: part.id, name: part.name, weightGrams: null });
    });
  });
});
