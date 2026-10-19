import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, readJson } from "./helpers.js";

// La clé weightGrams est obligatoire (entier ou null) : une réponse qui ne l'expose pas échoue à la validation.
const partWithWeightSchema = z.object({
  id: z.number().int(),
  kind: z.enum(["blade", "ratchet", "bit"]),
  name: z.string(),
  weightGrams: z.number().int().nullable(),
});
const listSchema = z.array(partWithWeightSchema);

async function listParts(query = ""): Promise<z.output<typeof listSchema>> {
  return readJson(await get(`/api/parts${query}`), listSchema);
}

// Pour trouver l'id, on ne lit que id et name : le détail doit être jugé sur sa propre réponse.
async function idOf(name: string): Promise<number> {
  const parts = await readJson(await get("/api/parts"), z.array(z.object({ id: z.number().int(), name: z.string() })));
  const part = parts.find((p) => p.name === name);
  if (part === undefined) throw new Error(`seeded part "${name}" not found`);
  return part.id;
}

function seedWeightOf(name: string): number {
  const seed = SEED_PARTS.find((p) => p.name === name);
  if (seed === undefined) throw new Error(`seeded part "${name}" not found`);
  return seed.weightGrams;
}

describe("GET /api/parts exposes weightGrams", () => {
  it("gives every part of the list a non-null weight", async () => {
    const body = await listParts();
    expect(body.every((p) => p.weightGrams !== null)).toBe(true);
  });

  it.each(SEED_PARTS)("gives $name its seeded weight in the list", async (seed) => {
    const row = (await listParts()).find((p) => p.name === seed.name);
    expect(row?.weightGrams).toBe(seed.weightGrams);
  });
});

describe("GET /api/parts/:id exposes weightGrams", () => {
  it.each(SEED_PARTS)("gives $name its seeded weight on the detail route", async (seed) => {
    const id = await idOf(seed.name);
    const body = await readJson(await get(`/api/parts/${String(id)}`), partWithWeightSchema);
    expect(body.name).toBe(seed.name);
    expect(body.weightGrams).toBe(seed.weightGrams);
  });
});

describe("GET /api/parts filters, search and order still work with weights", () => {
  it.each(["blade", "ratchet", "bit"] as const)("filters on kind=%s and carries each weight", async (kind) => {
    const body = await listParts(`?kind=${kind}`);
    const expected = SEED_PARTS.filter((p) => p.kind === kind);
    expect(body.every((p) => p.kind === kind)).toBe(true);
    expect(body.map((p) => p.name).sort()).toEqual(expected.map((p) => p.name).sort());
    for (const seed of expected) {
      expect(body.find((p) => p.name === seed.name)?.weightGrams).toBe(seed.weightGrams);
    }
  });

  it("searches by name and carries the weight of the match", async () => {
    const body = await listParts("?search=dran");
    expect(body.every((p) => p.name.toLowerCase().includes("dran"))).toBe(true);
    expect(body.find((p) => p.name === "Dran Sword")?.weightGrams).toBe(seedWeightOf("Dran Sword"));
  });

  it("combines search and kind and carries the weight of the result", async () => {
    const body = await listParts("?search=dran&kind=blade");
    expect(body.map((p) => p.name)).toEqual(["Dran Sword"]);
    expect(body[0]?.weightGrams).toBe(seedWeightOf("Dran Sword"));
  });

  it("keeps the kind-then-id order and carries the weight of each part", async () => {
    const body = await listParts();
    const kinds = body.map((p) => p.kind);
    expect(kinds).toEqual([...kinds].sort());
    for (const kind of ["blade", "ratchet", "bit"] as const) {
      const ids = body.filter((p) => p.kind === kind).map((p) => p.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    }
    for (const seed of SEED_PARTS) {
      expect(body.find((p) => p.name === seed.name)?.weightGrams).toBe(seed.weightGrams);
    }
  });
});
