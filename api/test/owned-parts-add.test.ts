import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { get, partSchema, readJson } from "./helpers.js";

const ownedPartSchema = z.object({
  id: z.number(),
  partId: z.number(),
  quantity: z.number(),
  part: partSchema,
});

const listSchema = z.array(ownedPartSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function postOwned(body: unknown): Promise<Response> {
  return app.request("/api/owned-parts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Chaque test crée sa propre pièce (aucune ligne d'inventaire dans le seed) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; kind: string; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await readJson(await get("/api/owned-parts"), listSchema);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/owned-parts: création (201)", () => {
  it("creates the row with 201 and returns the full row, as GET does", async () => {
    const part = await makePart();
    const res = await postOwned({ partId: part.id, quantity: 3 });
    expect(res.status).toBe(201);
    const body = await readJson(res, ownedPartSchema);
    expect(body).toMatchObject({ partId: part.id, quantity: 3, part: { id: part.id, kind: "blade", name: part.name } });
    expect(await rowsFor(part.id)).toEqual([body]);
  });

  it.each([1, 99])("accepts the quantity bound %i for a part not owned yet", async (quantity) => {
    const part = await makePart();
    const res = await postOwned({ partId: part.id, quantity });
    expect(res.status).toBe(201);
    const body = await readJson(res, ownedPartSchema);
    expect(body.quantity).toBe(quantity);
  });
});

describe("POST /api/owned-parts: ajout à une pièce déjà possédée (200)", () => {
  it("adds the quantity to the existing row, returns the full row with 200", async () => {
    const part = await makePart();
    const created = await readJson(await postOwned({ partId: part.id, quantity: 3 }), ownedPartSchema);

    const res = await postOwned({ partId: part.id, quantity: 4 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body).toEqual({ id: created.id, partId: part.id, quantity: 7, part: created.part });
    expect(await rowsFor(part.id)).toEqual([body]);
  });

  it("keeps a single row for the part after several additions", async () => {
    const part = await makePart();
    await postOwned({ partId: part.id, quantity: 1 });
    await postOwned({ partId: part.id, quantity: 2 });
    await postOwned({ partId: part.id, quantity: 5 });

    const rows = await rowsFor(part.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(8);
  });
});

describe("POST /api/owned-parts: plafond de 99", () => {
  it("accepts a total of exactly 99", async () => {
    const part = await makePart();
    expect((await postOwned({ partId: part.id, quantity: 50 })).status).toBe(201);
    const res = await postOwned({ partId: part.id, quantity: 49 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body.quantity).toBe(99);
  });

  it.each([
    [99, 1],
    [50, 50],
  ] as const)("refuses with 409 'quantity limit' when %i then %i would exceed 99", async (first, second) => {
    const part = await makePart();
    expect((await postOwned({ partId: part.id, quantity: first })).status).toBe(201);

    const res = await postOwned({ partId: part.id, quantity: second });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBe("quantity limit");

    const rows = await rowsFor(part.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(first);
  });
});

describe("POST /api/owned-parts: erreurs", () => {
  it("returns 404 with an error for an unknown part, and creates no row", async () => {
    const ids = (await readJson(await get("/api/parts"), z.array(partSchema))).map((p) => p.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await postOwned({ partId: unknown, quantity: 1 });
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(unknown)).toEqual([]);
  });

  const invalidQuantities: unknown[] = [0, 100, -1, 1.5, "3", null];

  it.each(invalidQuantities)("returns 400 with an error for quantity %s, and creates no row", async (quantity) => {
    const part = await makePart();
    const res = await postOwned({ partId: part.id, quantity });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(part.id)).toEqual([]);
  });

  it("returns 400 with an error when quantity is missing", async () => {
    const part = await makePart();
    const res = await postOwned({ partId: part.id });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(part.id)).toEqual([]);
  });
});
