import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function listParts(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/parts"), listSchema);
}

async function idOf(name: string): Promise<number> {
  const part = (await listParts()).find((p) => p.name === name);
  if (part === undefined) throw new Error(`seeded part "${name}" not found`);
  return part.id;
}

describe("GET /api/parts/:id", () => {
  it("returns 200 with the part for a known id", async () => {
    const id = await idOf("Dran Sword");
    const res = await get(`/api/parts/${String(id)}`);
    expect(res.status).toBe(200);
    const body = await readJson(res, partSchema);
    expect(body).toEqual({ id, kind: "blade", name: "Dran Sword" });
  });

  it.each(["blade", "ratchet", "bit"] as const)("returns a %s with its kind", async (kind) => {
    const expected = SEED_PARTS.find((p) => p.kind === kind);
    if (expected === undefined) throw new Error(`no seeded ${kind}`);
    const id = await idOf(expected.name);
    const body = await readJson(await get(`/api/parts/${String(id)}`), partSchema);
    expect(body).toEqual({ id, kind, name: expected.name });
  });

  it("returns 404 with an error message for an unknown id", async () => {
    const ids = (await listParts()).map((p) => p.id);
    const unknown = Math.max(0, ...ids) + 1;
    const res = await get(`/api/parts/${String(unknown)}`);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it.each(["0", "-1", "1.5", "abc"])("returns 400 with an error message for id %s", async (raw) => {
    const res = await get(`/api/parts/${raw}`);
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("keeps GET /api/parts and its kind filter working", async () => {
    const all = await get("/api/parts");
    expect(all.status).toBe(200);
    const blades = await readJson(await get("/api/parts?kind=blade"), listSchema);
    expect(blades.length).toBeGreaterThan(0);
    expect(blades.every((p) => p.kind === "blade")).toBe(true);
  });
});
