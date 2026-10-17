import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);

describe("GET /api/parts", () => {
  it("returns every seeded part", async () => {
    const res = await get("/api/parts");
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect(body).toHaveLength(SEED_PARTS.length);
    expect(body.map((p) => p.name).sort()).toEqual(SEED_PARTS.map((p) => p.name).sort());
  });

  it.each(["blade", "ratchet", "bit"] as const)("filters on kind=%s", async (kind) => {
    const body = await readJson(await get(`/api/parts?kind=${kind}`), listSchema);
    const expected = SEED_PARTS.filter((p) => p.kind === kind).map((p) => p.name);
    expect(expected.length).toBeGreaterThan(0);
    expect(body.every((p) => p.kind === kind)).toBe(true);
    expect(body.map((p) => p.name).sort()).toEqual(expected.sort());
  });

  it("orders parts by kind, then by id", async () => {
    const body = await readJson(await get("/api/parts"), listSchema);
    const kinds = body.map((p) => p.kind);
    expect(kinds).toEqual([...kinds].sort());
    for (const kind of ["blade", "ratchet", "bit"] as const) {
      const ids = body.filter((p) => p.kind === kind).map((p) => p.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    }
  });

  it("rejects an unknown kind with 400", async () => {
    expect((await get("/api/parts?kind=wheel")).status).toBe(400);
  });

  it("is not reachable without the /api prefix", async () => {
    expect((await get("/parts")).status).toBe(404);
  });
});
