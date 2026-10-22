import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { SEED_BUILD } from "../src/seed-data.js";
import { authed, partSchema, readJson } from "./helpers.js";

const buildSchema = z.object({
  id: z.number(),
  name: z.string(),
  notes: z.string().nullable(),
  parts: z.array(partSchema),
});

const listSchema = z.array(buildSchema);
const missingSchema = z.array(partSchema);
const notFoundSchema = z.strictObject({ error: z.literal("not found") });
const jsonHeaders = { "content-type": "application/json" };

type Kind = "blade" | "ratchet" | "bit";
type TestPart = z.output<typeof partSchema>;

// Cible d'une requête : un build, une pièce qui y est attachée, et une pièce qui ne l'est pas.
type Target = { buildId: number; attachedPartId: number; freePartId: number };

// État du build de seed de `me`, relevé avant chaque test de la section « alice contre le seed » pour le remettre en place.
type SeedSnapshot = { id: number; ownerId: number; name: string; notes: string | null; attachedPartId: number; partIds: number[] };

// Chaque test crée ses builds, pièces et lignes d'inventaire, puis les supprime : la base test.db est partagée.
const createdBuildIds: number[] = [];
const createdPartIds: number[] = [];

// Chaque route qui désigne un build par son :id. `send` reçoit la cible et l'utilisateur qui envoie la requête.
const routes: { label: string; send: (target: Target, as: string) => Promise<Response> }[] = [
  {
    label: "PATCH /api/builds/:id",
    send: ({ buildId }, as) =>
      authed(
        `/api/builds/${String(buildId)}`,
        { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: `Intrus ${randomUUID()}`, notes: "Intrus" }) },
        as,
      ),
  },
  {
    label: "GET /api/builds/:id/missing",
    send: ({ buildId }, as) => authed(`/api/builds/${String(buildId)}/missing`, {}, as),
  },
  {
    label: "POST /api/builds/:id/parts",
    send: ({ buildId, freePartId }, as) =>
      authed(
        `/api/builds/${String(buildId)}/parts`,
        { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: freePartId }) },
        as,
      ),
  },
  {
    label: "DELETE /api/builds/:id",
    send: ({ buildId }, as) => authed(`/api/builds/${String(buildId)}`, { method: "DELETE" }, as),
  },
  {
    label: "DELETE /api/builds/:id/parts/:partId",
    send: ({ buildId, attachedPartId }, as) =>
      authed(`/api/builds/${String(buildId)}/parts/${String(attachedPartId)}`, { method: "DELETE" }, as),
  },
];

async function makePart(kind: Kind): Promise<TestPart> {
  const part = await db.part.create({ data: { kind, name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return partSchema.parse(part);
}

// Pièce du seed, lue par son nom : elle sert aux cas où `me` la possède et `alice` non.
async function seedPart(name: string): Promise<TestPart> {
  const part = await db.part.findUnique({ where: { name } });
  if (part === null) throw new Error(`pièce de seed introuvable : ${name}`);
  return partSchema.parse(part);
}

// Crée un build par la route publique, en tant que `as` : le test suit ce qu'il crée.
async function createBuildAs(as: string): Promise<number> {
  const res = await authed(
    "/api/builds",
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: `Build de test ${randomUUID()}` }) },
    as,
  );
  expect(res.status).toBe(201);
  const created = await readJson(res, buildSchema);
  createdBuildIds.push(created.id);
  return created.id;
}

async function addPartAs(as: string, buildId: number, partId: number): Promise<Response> {
  return authed(
    `/api/builds/${String(buildId)}/parts`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId }) },
    as,
  );
}

async function ownAs(as: string, partId: number): Promise<void> {
  const res = await authed(
    "/api/owned-parts",
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId, quantity: 1 }) },
    as,
  );
  expect(res.status).toBe(201);
}

// Le build tel que `as` le voit dans sa liste : undefined s'il n'y figure pas.
async function buildAs(as: string, buildId: number): Promise<z.output<typeof buildSchema> | undefined> {
  const body = await readJson(await authed("/api/builds", {}, as), listSchema);
  return body.find((build) => build.id === buildId);
}

async function missingAs(as: string, buildId: number): Promise<TestPart[]> {
  const res = await authed(`/api/builds/${String(buildId)}/missing`, {}, as);
  expect(res.status).toBe(200);
  return readJson(res, missingSchema);
}

// Un build d'alice avec une pièce attachée et une pièce libre : cible des requêtes de `me`.
async function aliceBuildWithPart(): Promise<Target> {
  const buildId = await createBuildAs("alice");
  const attached = await makePart("blade");
  const free = await makePart("ratchet");
  expect((await addPartAs("alice", buildId, attached.id)).status).toBe(201);
  return { buildId, attachedPartId: attached.id, freePartId: free.id };
}

async function snapshotSeedBuild(): Promise<SeedSnapshot> {
  const build = await db.build.findFirst({
    where: { name: SEED_BUILD.name },
    include: { parts: { orderBy: { id: "asc" } } },
  });
  if (build === null) throw new Error("build de seed introuvable");
  const [first] = build.parts;
  if (first === undefined) throw new Error("build de seed sans pièce");
  return {
    id: build.id,
    ownerId: build.ownerId,
    name: build.name,
    notes: build.notes,
    attachedPartId: first.partId,
    partIds: build.parts.map((bp) => bp.partId),
  };
}

// Remet le build de seed dans l'état relevé avant le test, au cas où une requête refusée l'aurait touché.
async function restoreSeedBuild(seed: SeedSnapshot): Promise<void> {
  await db.buildPart.deleteMany({ where: { buildId: seed.id } });
  await db.build.upsert({
    where: { id: seed.id },
    create: { id: seed.id, ownerId: seed.ownerId, name: seed.name, notes: seed.notes },
    update: { name: seed.name, notes: seed.notes },
  });
  await db.buildPart.createMany({ data: seed.partIds.map((partId) => ({ buildId: seed.id, partId })) });
}

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("routes par :id : build d'alice vu par me (404 not found)", () => {
  it.each(routes)("$label answers 404 not found to me on a build of alice", async ({ send }) => {
    const target = await aliceBuildWithPart();
    const res = await send(target, "me");
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });

  it.each(routes)("$label answers the same 404 for a build that does not exist", async ({ send }) => {
    const live = await aliceBuildWithPart();
    const ghostId = await createBuildAs("alice");
    await db.build.delete({ where: { id: ghostId } });

    const onAlice = await send(live, "me");
    const onGhost = await send({ ...live, buildId: ghostId }, "me");
    expect(onAlice.status).toBe(404);
    expect(onGhost.status).toBe(404);
    expect(await readJson(onGhost, notFoundSchema)).toEqual(await readJson(onAlice, notFoundSchema));
  });

  it("leaves alice's build unchanged after every refused request by me", async () => {
    const target = await aliceBuildWithPart();
    const before = await buildAs("alice", target.buildId);
    expect(before).toBeDefined();

    for (const { send } of routes) await send(target, "me");

    expect(await buildAs("alice", target.buildId)).toEqual(before);
    expect(before?.parts.map((p) => p.id)).toEqual([target.attachedPartId]);
  });
});

describe("routes par :id : build de me vu par alice (404 not found)", () => {
  let seed: SeedSnapshot | undefined;

  function requireSeed(): SeedSnapshot {
    if (seed === undefined) throw new Error("snapshot du seed manquant");
    return seed;
  }

  async function seedTarget(): Promise<Target> {
    const current = requireSeed();
    const free = await makePart("bit");
    return { buildId: current.id, attachedPartId: current.attachedPartId, freePartId: free.id };
  }

  beforeEach(async () => {
    seed = await snapshotSeedBuild();
  });

  afterEach(async () => {
    if (seed !== undefined) await restoreSeedBuild(seed);
    seed = undefined;
  });

  it.each(routes)("$label answers 404 not found to alice on the seeded build of me", async ({ send }) => {
    const target = await seedTarget();
    const res = await send(target, "alice");
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });

  it("leaves my seeded build unchanged after every refused request by alice", async () => {
    const target = await seedTarget();
    const before = await buildAs("me", target.buildId);
    expect(before).toBeDefined();

    for (const { send } of routes) await send(target, "alice");

    expect(await buildAs("me", target.buildId)).toEqual(before);
  });
});

describe("GET /api/builds/:id/missing : pièces possédées par l'utilisateur connecté", () => {
  it("computes the missing parts of alice's build from alice's inventory, not mine", async () => {
    const buildId = await createBuildAs("alice");
    const dranSword = await seedPart("Dran Sword");
    const fresh = await makePart("ratchet");
    expect((await addPartAs("alice", buildId, dranSword.id)).status).toBe(201);
    expect((await addPartAs("alice", buildId, fresh.id)).status).toBe(201);

    // Dran Sword appartient à me (seed), pas à alice : il doit rester manquant pour alice.
    const before = await missingAs("alice", buildId);
    expect([...before].sort((a, b) => a.id - b.id)).toEqual([dranSword, fresh].sort((a, b) => a.id - b.id));

    await ownAs("alice", fresh.id);
    expect(await missingAs("alice", buildId)).toEqual([dranSword]);
  });

  it("keeps answering 200 for my own seeded build", async () => {
    const seed = await snapshotSeedBuild();
    const res = await authed(`/api/builds/${String(seed.id)}/missing`);
    expect(res.status).toBe(200);
    await readJson(res, missingSchema);
  });
});
