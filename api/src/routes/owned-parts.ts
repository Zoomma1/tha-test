import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const ownedPartSchema = z.object({
  id: z.number(),
  partId: z.number(),
  quantity: z.number(),
  part: z.object({ id: z.number(), kind: partKindSchema, name: z.string() }),
});

const addOwnedPartSchema = z.object({
  partId: z.number().int(),
  quantity: z.number().int().min(1).max(99),
});

const updateOwnedPartSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

const MAX_QUANTITY = 99;

type OwnedRow = {
  id: number;
  partId: number;
  quantity: number;
  part: { id: number; kind: string; name: string };
};

function toBody(r: OwnedRow): z.output<typeof ownedPartSchema> {
  return ownedPartSchema.parse({
    id: r.id,
    partId: r.partId,
    quantity: r.quantity,
    part: { id: r.part.id, kind: r.part.kind, name: r.part.name },
  });
}

export const ownedPartsRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.ownedPart.findMany({
      orderBy: { id: "asc" },
      include: { part: true },
    });
    return c.json(rows.map(toBody), 200);
  })
  .post("/", async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = addOwnedPartSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { partId, quantity } = parsed.data;

    const part = await db.part.findUnique({ where: { id: partId } });
    if (!part) return c.json({ error: "part not found" }, 404);

    const existing = await db.ownedPart.findFirst({ where: { partId } });
    if (existing) {
      if (existing.quantity + quantity > MAX_QUANTITY) {
        return c.json({ error: "quantity limit" }, 409);
      }
      const row = await db.ownedPart.update({
        where: { id: existing.id },
        data: { quantity: { increment: quantity } },
        include: { part: true },
      });
      return c.json(toBody(row), 200);
    }
    const row = await db.ownedPart.create({
      data: { partId, quantity },
      include: { part: true },
    });
    return c.json(toBody(row), 201);
  })
  .patch("/:id", async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = updateOwnedPartSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "owned part not found" }, 404);
    const existing = await db.ownedPart.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "owned part not found" }, 404);

    const row = await db.ownedPart.update({
      where: { id },
      data: { quantity: parsed.data.quantity },
      include: { part: true },
    });
    return c.json(toBody(row), 200);
  })
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "owned part not found" }, 404);
    const existing = await db.ownedPart.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "owned part not found" }, 404);

    await db.ownedPart.delete({ where: { id } });
    return c.body(null, 204);
  });
