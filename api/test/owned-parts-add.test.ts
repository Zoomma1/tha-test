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
const countSchema = z.array(z.object({ total: z.coerce.number() }));

// Chaque test crée ses propres pièces et supprime ses lignes d'inventaire : test.db est partagée.
const createdPartIds: number[] = [];

async function createPart(): Promise<number> {
  const part = await db.part.create({ data: { kind: "bit", name: `Pièce ajout ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part.id;
}

async function countOwnedRows(partId: number): Promise<number> {
  const rows = countSchema.parse(
    await db.$queryRaw`SELECT COUNT(*) AS "total" FROM "OwnedPart" WHERE "partId" = ${partId}`,
  );
  return rows[0]?.total ?? 0;
}

async function post(body: unknown): Promise<Response> {
  return app.request("/api/owned-parts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  for (const partId of ids) {
    await db.$executeRaw`DELETE FROM "OwnedPart" WHERE "partId" = ${partId}`;
    await db.part.delete({ where: { id: partId } });
  }
});

describe("POST /api/owned-parts", () => {
  it("creates the row with 201 for a part not owned yet, in the same shape as GET", async () => {
    const partId = await createPart();
    const res = await post({ partId, quantity: 3 });
    expect(res.status).toBe(201);
    const body = await readJson(res, ownedPartSchema);
    expect(body.partId).toBe(partId);
    expect(body.quantity).toBe(3);
    const listed = await readJson(await get("/api/owned-parts"), listSchema);
    expect(body).toEqual(listed.find((row) => row.id === body.id));
  });

  it("adds the quantity to the existing row with 200 and returns the full row", async () => {
    const partId = await createPart();
    const first = await readJson(await post({ partId, quantity: 2 }), ownedPartSchema);
    const res = await post({ partId, quantity: 3 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body.id).toBe(first.id);
    expect(body.quantity).toBe(5);
    const listed = await readJson(await get("/api/owned-parts"), listSchema);
    expect(body).toEqual(listed.find((row) => row.id === body.id));
  });

  it("never leaves two rows for the same part", async () => {
    const partId = await createPart();
    await post({ partId, quantity: 1 });
    await post({ partId, quantity: 4 });
    await post({ partId, quantity: 2 });
    expect(await countOwnedRows(partId)).toBe(1);
  });

  it("returns 404 with an error message for a part that does not exist", async () => {
    const ids = (await readJson(await get("/api/parts"), z.array(partSchema))).map((p) => p.id);
    const unknown = Math.max(0, ...ids) + 1;
    const res = await post({ partId: unknown, quantity: 1 });
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await countOwnedRows(unknown)).toBe(0);
  });

  it.each([0, 100, -1, 1.5, "3", null])("returns 400 with an error message for quantity %s", async (quantity) => {
    const partId = await createPart();
    const res = await post({ partId, quantity });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await countOwnedRows(partId)).toBe(0);
  });

  it("returns 400 when quantity is missing", async () => {
    const partId = await createPart();
    const res = await post({ partId });
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
    expect(await countOwnedRows(partId)).toBe(0);
  });

  it.each([{ quantity: 1 }, { partId: "abc", quantity: 1 }])("returns 400 for the invalid body %j", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    await readJson(res, errorSchema);
  });

  it("accepts the bounds 1 and 99", async () => {
    const low = await createPart();
    const high = await createPart();
    expect((await post({ partId: low, quantity: 1 })).status).toBe(201);
    expect((await post({ partId: high, quantity: 99 })).status).toBe(201);
  });

  it("accepts a total of exactly 99", async () => {
    const partId = await createPart();
    await post({ partId, quantity: 98 });
    const res = await post({ partId, quantity: 1 });
    expect(res.status).toBe(200);
    const body = await readJson(res, ownedPartSchema);
    expect(body.quantity).toBe(99);
  });

  it("returns 409 'quantity limit' when the total would exceed 99, and leaves the row unchanged", async () => {
    const partId = await createPart();
    await post({ partId, quantity: 98 });
    const res = await post({ partId, quantity: 2 });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBe("quantity limit");
    const listed = await readJson(await get("/api/owned-parts"), listSchema);
    expect(listed.find((row) => row.partId === partId)?.quantity).toBe(98);
    expect(await countOwnedRows(partId)).toBe(1);
  });
});
