import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  parts: z.array(z.object({ id: z.number(), kind: partKindSchema, name: z.string() })),
});

const createBuildSchema = z.object({ name: z.string().trim().min(1) });

export const buildsRoutes = new Hono()
  .get("/", async (c) => {
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
  })
  .post("/", async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = createBuildSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid name" }, 400);
    const { name } = parsed.data;

    const lower = name.toLowerCase();
    const all = await db.build.findMany({ select: { name: true } });
    if (all.some((b) => b.name.toLowerCase() === lower)) {
      return c.json({ error: "build name already exists" }, 409);
    }
    const row = await db.build.create({ data: { name } });
    return c.json(buildSchema.parse({ id: row.id, name: row.name, parts: [] }), 201);
  });
