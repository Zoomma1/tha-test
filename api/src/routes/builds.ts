import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  notes: z.string().nullable(),
  parts: z.array(z.object({ id: z.number(), kind: partKindSchema, name: z.string() })),
});

const createBuildSchema = z.object({ name: z.string().trim().min(1) });
const updateBuildSchema = z.object({
  name: z.string().trim().min(1).optional(),
  notes: z.string().max(500).optional(),
});
const addPartSchema = z.object({ partId: z.number().int() });

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
        notes: b.notes,
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
    return c.json(buildSchema.parse({ id: row.id, name: row.name, notes: row.notes, parts: [] }), 201);
  })
  .patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = updateBuildSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { name, notes } = parsed.data;

    const build = Number.isInteger(id) ? await db.build.findUnique({ where: { id } }) : null;
    if (build === null) return c.json({ error: "build not found" }, 404);

    if (name !== undefined) {
      const lower = name.toLowerCase();
      const others = await db.build.findMany({ where: { id: { not: id } }, select: { name: true } });
      if (others.some((b) => b.name.toLowerCase() === lower)) {
        return c.json({ error: "build name already exists" }, 409);
      }
    }
    const row = await db.build.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      include: { parts: { orderBy: { id: "asc" }, include: { part: true } } },
    });
    const body = buildSchema.parse({
      id: row.id,
      name: row.name,
      notes: row.notes,
      parts: row.parts.map((bp) => ({ id: bp.part.id, kind: bp.part.kind, name: bp.part.name })),
    });
    return c.json(body, 200);
  })
  .get("/:id/missing", async (c) => {
    const id = Number(c.req.param("id"));
    const build = Number.isInteger(id)
      ? await db.build.findUnique({
          where: { id },
          include: { parts: { orderBy: { id: "asc" }, include: { part: true } } },
        })
      : null;
    if (build === null) return c.json({ error: "build not found" }, 404);

    const owned = await db.ownedPart.findMany({
      where: { partId: { in: build.parts.map((bp) => bp.partId) } },
      select: { partId: true },
    });
    const ownedIds = new Set(owned.map((o) => o.partId));
    const body = z.array(buildSchema.shape.parts.element).parse(
      build.parts
        .filter((bp) => !ownedIds.has(bp.partId))
        .map((bp) => ({ id: bp.part.id, kind: bp.part.kind, name: bp.part.name })),
    );
    return c.json(body, 200);
  })
  .post("/:id/parts", async (c) => {
    const id = Number(c.req.param("id"));
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = addPartSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid partId" }, 400);
    const { partId } = parsed.data;

    const build = Number.isInteger(id)
      ? await db.build.findUnique({
          where: { id },
          include: { parts: { orderBy: { id: "asc" }, include: { part: true } } },
        })
      : null;
    if (build === null) return c.json({ error: "build not found" }, 404);
    const part = await db.part.findUnique({ where: { id: partId } });
    if (part === null) return c.json({ error: "part not found" }, 404);

    if (build.parts.some((bp) => bp.part.kind === part.kind)) {
      return c.json({ error: "slot taken" }, 409);
    }
    await db.buildPart.create({ data: { buildId: build.id, partId: part.id } });
    const body = buildSchema.parse({
      id: build.id,
      name: build.name,
      notes: build.notes,
      parts: [...build.parts.map((bp) => bp.part), part].map((p) => ({ id: p.id, kind: p.kind, name: p.name })),
    });
    return c.json(body, 201);
  })
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const build = Number.isInteger(id) ? await db.build.findUnique({ where: { id } }) : null;
    if (build === null) return c.json({ error: "build not found" }, 404);

    await db.$transaction([
      db.buildPart.deleteMany({ where: { buildId: id } }),
      db.build.delete({ where: { id } }),
    ]);
    return c.body(null, 204);
  })
  .delete("/:id/parts/:partId", async (c) => {
    const id = Number(c.req.param("id"));
    const partId = Number(c.req.param("partId"));
    if (!Number.isInteger(id) || !Number.isInteger(partId)) {
      return c.json({ error: "build part not found" }, 404);
    }
    const build = await db.build.findUnique({ where: { id } });
    if (build === null) return c.json({ error: "build not found" }, 404);

    const { count } = await db.buildPart.deleteMany({ where: { buildId: id, partId } });
    if (count === 0) return c.json({ error: "part not in build" }, 404);
    return c.body(null, 204);
  });
