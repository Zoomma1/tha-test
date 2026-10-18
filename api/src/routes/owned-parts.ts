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

const addBodySchema = z.object({
  partId: z.number().int(),
  quantity: z.number().int().min(1).max(99),
});

const MAX_QUANTITY = 99;

function toBody(r: { id: number; partId: number; quantity: number; part: { id: number; kind: string; name: string } }) {
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
    const parsed = addBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "invalid body" }, 400);
    }
    const { partId, quantity } = parsed.data;
    const part = await db.part.findUnique({ where: { id: partId } });
    if (!part) {
      return c.json({ error: "part not found" }, 404);
    }
    // Conditional increment: atomic, and refuses a total above the limit.
    const updated = await db.ownedPart.updateMany({
      where: { partId, quantity: { lte: MAX_QUANTITY - quantity } },
      data: { quantity: { increment: quantity } },
    });
    if (updated.count === 0) {
      const existing = await db.ownedPart.findUnique({ where: { partId } });
      if (existing) {
        return c.json({ error: "quantity limit" }, 409);
      }
      const created = await db.ownedPart.create({
        data: { partId, quantity },
        include: { part: true },
      });
      return c.json(toBody(created), 201);
    }
    const row = await db.ownedPart.findUniqueOrThrow({
      where: { partId },
      include: { part: true },
    });
    return c.json(toBody(row), 200);
  });
