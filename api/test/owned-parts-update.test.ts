import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { authed, partSchema, readJson } from "./helpers.js";

const ownedPartSchema = z.object({
  id: z.number(),
  partId: z.number(),
  quantity: z.number(),
  part: partSchema,
});

const listSchema = z.array(ownedPartSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function postOwned(body: unknown): Promise<Response> {
  return authed("/api/owned-parts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOwned(id: number, body: unknown): Promise<Response> {
  return authed(`/api/owned-parts/${String(id)}`, {
    method: "PATCH",
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

// La ligne d'inventaire est créée par la route publique POST, comme un appelant le ferait.
async function makeOwned(quantity: number): Promise<z.output<typeof ownedPartSchema>> {
  const part = await makePart();
  return readJson(await postOwned({ partId: part.id, quantity }), ownedPartSchema);
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await readJson(await authed("/api/owned-parts"), listSchema);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("PATCH /api/owned-parts/:id: remplacement de la quantité (200)", () => {
  it("replaces the quantity and returns the full row with 200", async () => {
    const created = await makeOwned(3);

    const res = await patchOwned(created.id, { quantity: 10 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body).toEqual({ id: created.id, partId: created.partId, quantity: 10, part: created.part });
    expect(await rowsFor(created.partId)).toEqual([body]);
  });

  it("replaces rather than adds: 3 then 5 leaves 5", async () => {
    const created = await makeOwned(3);

    const res = await patchOwned(created.id, { quantity: 5 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body.quantity).toBe(5);
  });

  it.each([1, 99])("accepts the quantity bound %i", async (quantity) => {
    const created = await makeOwned(3);

    const res = await patchOwned(created.id, { quantity });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body.quantity).toBe(quantity);
  });

  it("changes only the targeted row", async () => {
    const target = await makeOwned(3);
    const other = await makeOwned(7);

    expect((await patchOwned(target.id, { quantity: 9 })).status).toBe(200);

    expect((await rowsFor(target.partId))[0]?.quantity).toBe(9);
    expect((await rowsFor(other.partId))[0]?.quantity).toBe(7);
  });
});

describe("PATCH /api/owned-parts/:id: erreurs", () => {
  it("returns 404 with an error for an unknown id", async () => {
    const rows = await readJson(await authed("/api/owned-parts"), listSchema);
    const unknown = Math.max(0, ...rows.map((row) => row.id)) + 1;

    const res = await patchOwned(unknown, { quantity: 4 });
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  const invalidQuantities: unknown[] = [0, 100, -1, 1.5, "3", null];

  it.each(invalidQuantities)("returns 400 with an error for quantity %s, and keeps the row unchanged", async (quantity) => {
    const created = await makeOwned(3);

    const res = await patchOwned(created.id, { quantity });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await rowsFor(created.partId))[0]?.quantity).toBe(3);
  });

  it("returns 400 with an error when quantity is missing, and keeps the row unchanged", async () => {
    const created = await makeOwned(3);

    const res = await patchOwned(created.id, {});
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await rowsFor(created.partId))[0]?.quantity).toBe(3);
  });
});
