import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);
const errorSchema = z.object({ error: z.string().min(1) });

// Lit la liste publique pour obtenir des ids réels, sans dépendre de l'ordre ni du nombre de lignes.
async function listedParts(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/parts"), listSchema);
}

describe("GET /api/parts/:id", () => {
  it("returns the part for a known id", async () => {
    const [listed] = await listedParts();
    if (listed === undefined) throw new Error("the seed has no part");

    const res = await get(`/api/parts/${listed.id}`);
    expect(res.status).toBe(200);
    const body = await readJson(res, partSchema);
    expect(body).toEqual(listed);
    expect(SEED_PARTS.map((p) => p.name)).toContain(body.name);
  });

  it("returns exactly id, kind and name", async () => {
    const [listed] = await listedParts();
    if (listed === undefined) throw new Error("the seed has no part");

    const raw: unknown = await (await get(`/api/parts/${listed.id}`)).json();
    expect(raw).toEqual({ id: listed.id, kind: listed.kind, name: listed.name });
  });

  it("returns 404 with an error message for an unknown id", async () => {
    const ids = (await listedParts()).map((p) => p.id);
    // Un id plus grand que tous ceux du seed : absent par construction.
    const missing = Math.max(0, ...ids) + 1;

    const res = await get(`/api/parts/${missing}`);
    expect(res.status).toBe(404);
    await readJson(res, errorSchema);
  });

  it.each(["0", "-1", "1.5", "abc"])("returns 400 with an error message for id %s", async (id) => {
    const res = await get(`/api/parts/${id}`);
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });
});
