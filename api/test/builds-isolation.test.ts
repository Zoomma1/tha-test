import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
type TestPart = { id: number; kind: Kind; name: string };
type Target = { buildId: number; attachedId: number; freshId: number };
type Attempt = { label: string; send: (target: Target, as: string) => Promise<Response> };

// Chaque test crée ses builds, pièces et lignes d'inventaire, puis les supprime : la base test.db est partagée.
// Le build seedé (à `me`) n'est jamais supprimé par ce fichier : on ne fait que le lire.
const createdBuildIds: number[] = [];
const createdPartIds: number[] = [];

async function makePart(kind: Kind): Promise<TestPart> {
  const part = await db.part.create({ data: { kind, name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id, kind, name: part.name };
}

// Crée un build d'Alice par la route publique, puis y attache une lame (le test suit ce qu'il crée).
async function makeAliceBuild(): Promise<{ id: number; blade: TestPart }> {
  const res = await authed(
    "/api/builds",
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: `Build d'Alice ${randomUUID()}` }) },
    "alice",
  );
  expect(res.status).toBe(201);
  const created = await readJson(res, buildSchema);
  createdBuildIds.push(created.id);

  const blade = await makePart("blade");
  const attached = await authed(
    `/api/builds/${String(created.id)}/parts`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: blade.id }) },
    "alice",
  );
  expect(attached.status).toBe(201);
  return { id: created.id, blade };
}

// Le build seedé, tel que `me` le voit : c'est lui qu'Alice ne doit pas toucher.
async function seededBuild(): Promise<z.output<typeof buildSchema>> {
  const body = await readJson(await authed("/api/builds"), listSchema);
  const seeded = body.find((build) => build.name === SEED_BUILD.name);
  if (seeded === undefined) throw new Error("le build seedé est introuvable");
  return seeded;
}

// État d'un build tel que son propriétaire le voit ; undefined s'il a disparu.
async function viewOf(as: string, buildId: number): Promise<z.output<typeof buildSchema> | undefined> {
  const body = await readJson(await authed("/api/builds", {}, as), listSchema);
  return body.find((build) => build.id === buildId);
}

const attempts: Attempt[] = [
  {
    label: "PATCH /api/builds/:id",
    send: ({ buildId }, as) =>
      authed(`/api/builds/${String(buildId)}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ notes: "Modifié par un autre" }) }, as),
  },
  {
    label: "DELETE /api/builds/:id",
    send: ({ buildId }, as) => authed(`/api/builds/${String(buildId)}`, { method: "DELETE" }, as),
  },
  {
    label: "GET /api/builds/:id/missing",
    send: ({ buildId }, as) => authed(`/api/builds/${String(buildId)}/missing`, {}, as),
  },
  {
    label: "POST /api/builds/:id/parts",
    send: ({ buildId, freshId }, as) =>
      authed(`/api/builds/${String(buildId)}/parts`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: freshId }) }, as),
  },
  {
    label: "DELETE /api/builds/:id/parts/:partId",
    send: ({ buildId, attachedId }, as) =>
      authed(`/api/builds/${String(buildId)}/parts/${String(attachedId)}`, { method: "DELETE" }, as),
  },
];

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: partIds } } });
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("routes par :id : un build d'un autre utilisateur répond 404 not found", () => {
  it.each(attempts)("$label : me gets 404 on alice's build, which stays unchanged", async ({ send }) => {
    const alice = await makeAliceBuild();
    const target: Target = { buildId: alice.id, attachedId: alice.blade.id, freshId: (await makePart("bit")).id };
    const before = await viewOf("alice", alice.id);

    const res = await send(target, "me");
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
    expect(await viewOf("alice", alice.id)).toEqual(before);
  });

  describe("alice sur le build seedé (à me)", () => {
    // Lu une fois avant les tentatives : si une route le supprime, les tests suivants comparent quand même au même état.
    let seeded: z.output<typeof buildSchema>;
    beforeAll(async () => {
      seeded = await seededBuild();
    });

    it.each(attempts)("$label : alice gets 404 on the seeded build, which stays unchanged", async ({ send }) => {
      const [attached] = seeded.parts;
      if (attached === undefined) throw new Error("le build seedé n'a pas de pièce");
      const target: Target = { buildId: seeded.id, attachedId: attached.id, freshId: (await makePart("bit")).id };

      const res = await send(target, "alice");
      expect(res.status).toBe(404);
      expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
      expect(await viewOf("me", seeded.id)).toEqual(seeded);
    });
  });
});

describe("routes par :id : un build inexistant répond le même 404 not found", () => {
  it.each(attempts)("$label answers 404 not found for a build that does not exist", async ({ send }) => {
    const gone = await db.build.create({ data: { name: `Build supprimé ${randomUUID()}` } });
    await db.build.delete({ where: { id: gone.id } });

    const target: Target = { buildId: gone.id, attachedId: (await makePart("blade")).id, freshId: (await makePart("bit")).id };
    const res = await send(target, "me");
    expect(res.status).toBe(404);
    expect(await readJson(res, notFoundSchema)).toEqual({ error: "not found" });
  });
});

describe("GET /api/builds/:id/missing : compare aux pièces de l'utilisateur connecté", () => {
  it("computes alice's missing parts from alice's inventory, not from me's", async () => {
    const alice = await makeAliceBuild();
    const ratchet = await makePart("ratchet");
    const attached = await authed(
      `/api/builds/${String(alice.id)}/parts`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: ratchet.id }) },
      "alice",
    );
    expect(attached.status).toBe(201);

    // Alice possède la lame, `me` possède le ratchet : chacun ne doit compter que son inventaire.
    const aliceOwns = await authed(
      "/api/owned-parts",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: alice.blade.id, quantity: 1 }) },
      "alice",
    );
    expect(aliceOwns.status).toBe(201);
    const meOwns = await authed(
      "/api/owned-parts",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ partId: ratchet.id, quantity: 1 }) },
      "me",
    );
    expect(meOwns.status).toBe(201);

    const res = await authed(`/api/builds/${String(alice.id)}/missing`, {}, "alice");
    expect(res.status).toBe(200);
    expect(await readJson(res, missingSchema)).toEqual([ratchet]);
  });
});
