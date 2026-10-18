import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  parts: z.array(z.object({ id: z.number(), kind: partKindSchema, name: z.string() })),
});

export const buildsRoutes = new Hono().get("/", async (c) => {
  const rows = await db.build.findMany({
    orderBy: { id: "asc" },
    include: { parts: { orderBy: { id: "asc" }, include: { part: true } } },
  });
  const body = z.array(buildSchema).parse(
    rows.map((b) => ({
      id: b.id,
      name: b.name,
      parts: b.parts.map((bp) => ({ id: bp.part.id, kind: bp.part.kind, name: bp.part.name })),
    })),
  );
  return c.json(body, 200);
});
