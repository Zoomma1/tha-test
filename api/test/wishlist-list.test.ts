import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS, SEED_WISHLIST } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);

describe("GET /api/wishlist", () => {
  it("returns 200 with a body that matches the output schema", async () => {
    const res = await get("/api/wishlist");
    expect(res.status).toBe(200);
    await readJson(res, listSchema);
  });

  it.each(SEED_WISHLIST)("lists $partName with note $note", async ({ partName, note }) => {
    const body = await readJson(await get("/api/wishlist"), listSchema);
    const matches = body.filter((row) => row.part.name === partName);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.note).toBe(note);
    expect(matches[0]?.part.kind).toBe(SEED_PARTS.find((p) => p.name === partName)?.kind);
  });

  it("gives each row the part it refers to", async () => {
    const body = await readJson(await get("/api/wishlist"), listSchema);
    for (const row of body) {
      expect(row.part.id).toBe(row.partId);
    }
  });

  it("orders rows by id, ascending", async () => {
    const body = await readJson(await get("/api/wishlist"), listSchema);
    const ids = body.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });
});
