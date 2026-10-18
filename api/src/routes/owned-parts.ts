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

export const ownedPartsRoutes = new Hono().get("/", async (c) => {
  const rows = await db.ownedPart.findMany({
    orderBy: { id: "asc" },
    include: { part: true },
  });
  const body = z.array(ownedPartSchema).parse(
    rows.map((r) => ({
      id: r.id,
      partId: r.partId,
      quantity: r.quantity,
      part: { id: r.part.id, kind: r.part.kind, name: r.part.name },
    })),
  );
  return c.json(body, 200);
});
