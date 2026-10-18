import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_OWNED, SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const ownedPartSchema = z.object({
  id: z.number(),
  partId: z.number(),
  quantity: z.number(),
  part: partSchema,
});

const listSchema = z.array(ownedPartSchema);

describe("GET /api/owned-parts", () => {
  it("returns 200 with a body that matches the output schema", async () => {
    const res = await get("/api/owned-parts");
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect(body.length).toBeGreaterThan(0);
  });

  it.each(SEED_OWNED)("lists $partName with quantity $quantity", async ({ partName, quantity }) => {
    const body = await readJson(await get("/api/owned-parts"), listSchema);
    const matches = body.filter((row) => row.part.name === partName);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.quantity).toBe(quantity);
    expect(matches[0]?.part.kind).toBe(SEED_PARTS.find((p) => p.name === partName)?.kind);
  });

  it("gives each row the part it refers to", async () => {
    const body = await readJson(await get("/api/owned-parts"), listSchema);
    for (const row of body) {
      expect(row.part.id).toBe(row.partId);
    }
  });

  it("orders rows by id, ascending", async () => {
    const body = await readJson(await get("/api/owned-parts"), listSchema);
    const ids = body.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });
});
