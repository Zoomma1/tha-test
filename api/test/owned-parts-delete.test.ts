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

async function deleteOwned(id: number): Promise<Response> {
  return app.request(`/api/owned-parts/${String(id)}`, { method: "DELETE" });
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

async function listAll(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/owned-parts"), listSchema);
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await listAll();
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("DELETE /api/owned-parts/:id: suppression (204)", () => {
  it("returns 204 with an empty body", async () => {
    const created = await makeOwned(3);

    const res = await deleteOwned(created.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("removes the row from GET /api/owned-parts", async () => {
    const created = await makeOwned(3);
    expect(await rowsFor(created.partId)).toHaveLength(1);

    expect((await deleteOwned(created.id)).status).toBe(204);

    expect(await rowsFor(created.partId)).toEqual([]);
    expect((await listAll()).map((row) => row.id)).not.toContain(created.id);
  });

  it("removes only the targeted row and leaves the other rows in place", async () => {
    const kept = await makeOwned(3);
    const removed = await makeOwned(7);
    const before = (await listAll()).map((row) => row.id);

    expect((await deleteOwned(removed.id)).status).toBe(204);

    const after = (await listAll()).map((row) => row.id);
    expect(after).toEqual(before.filter((id) => id !== removed.id));
    expect(after).toContain(kept.id);
  });

  it("keeps the seeded inventory rows when another row is deleted", async () => {
    const seeded = (await listAll()).find((row) => row.part.name === "Dran Sword");
    const created = await makeOwned(3);

    expect((await deleteOwned(created.id)).status).toBe(204);

    expect(seeded).toBeDefined();
    expect((await listAll()).map((row) => row.id)).toContain(seeded?.id);
  });
});

describe("DELETE /api/owned-parts/:id: id inconnu (404)", () => {
  it("returns 404 with an error for an id that does not exist", async () => {
    const ids = (await listAll()).map((row) => row.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await deleteOwned(unknown);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 404 when the row was already deleted, and the list is unchanged", async () => {
    const created = await makeOwned(3);
    expect((await deleteOwned(created.id)).status).toBe(204);
    const before = (await listAll()).map((row) => row.id);

    const res = await deleteOwned(created.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listAll()).map((row) => row.id)).toEqual(before);
  });
});
