import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
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
const unauthorizedSchema = z.strictObject({ error: z.literal("unauthorized") });
const jsonHeaders = { "content-type": "application/json" };

type Kind = "blade" | "ratchet" | "bit";
type TestPart = { id: number; kind: Kind; name: string };

// Chaque test crée ses builds et pièces, puis les supprime : la base test.db est partagée.
// Les builds créés sans cookie portent le préfixe « Sans cookie » : s'ils existent, on les retire aussi.
const createdBuildIds: number[] = [];
const createdPartIds: number[] = [];

async function makeBuild(): Promise<{ id: number; name: string }> {
  const build = await db.build.create({ data: { name: `Build de test ${randomUUID()}` } });
  createdBuildIds.push(build.id);
  return { id: build.id, name: build.name };
}

async function makePart(kind: Kind): Promise<TestPart> {
  const part = await db.part.create({ data: { kind, name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return { id: part.id, kind, name: part.name };
}

// Crée un build par la route publique, en tant que `as` : le test suit ce qu'il crée.
async function createBuildAs(as: string, name: string): Promise<number> {
  const res = await authed("/api/builds", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name }) }, as);
  expect(res.status).toBe(201);
  const created = await readJson(res, buildSchema);
  createdBuildIds.push(created.id);
  return created.id;
}

async function listedIds(as: string): Promise<number[]> {
  const body = await readJson(await authed("/api/builds", {}, as), listSchema);
  return body.map((build) => build.id);
}

const unauthRoutes: { label: string; send: (buildId: number, partId: number) => Response | Promise<Response> }[] = [
  { label: "GET /api/builds", send: () => app.request("/api/builds") },
  {
    label: "POST /api/builds",
    send: () =>
      app.request("/api/builds", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: `Sans cookie ${randomUUID()}` }),
      }),
  },
  {
    label: "PATCH /api/builds/:id",
    send: (buildId) =>
      app.request(`/api/builds/${String(buildId)}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ notes: "Sans cookie" }),
      }),
  },
  { label: "GET /api/builds/:id/missing", send: (buildId) => app.request(`/api/builds/${String(buildId)}/missing`) },
  {
    label: "POST /api/builds/:id/parts",
    send: (buildId, partId) =>
      app.request(`/api/builds/${String(buildId)}/parts`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ partId }),
      }),
  },
  { label: "DELETE /api/builds/:id", send: (buildId) => app.request(`/api/builds/${String(buildId)}`, { method: "DELETE" }) },
  {
    label: "DELETE /api/builds/:id/parts/:partId",
    send: (buildId, partId) =>
      app.request(`/api/builds/${String(buildId)}/parts/${String(partId)}`, { method: "DELETE" }),
  },
];

afterEach(async () => {
  const buildIds = createdBuildIds.splice(0);
  const partIds = createdPartIds.splice(0);
  await db.buildPart.deleteMany({ where: { OR: [{ buildId: { in: buildIds } }, { partId: { in: partIds } }] } });
  await db.build.deleteMany({ where: { id: { in: buildIds } } });
  await db.build.deleteMany({ where: { name: { startsWith: "Sans cookie" } } });
  await db.part.deleteMany({ where: { id: { in: partIds } } });
});

describe("routes des builds sans cookie valide (401)", () => {
  it.each(unauthRoutes)("$label answers 401 unauthorized without a cookie", async ({ send }) => {
    const build = await makeBuild();
    const part = await makePart("blade");
    const res = await send(build.id, part.id);
    expect(res.status).toBe(401);
    expect(await readJson(res, unauthorizedSchema)).toEqual({ error: "unauthorized" });
  });

  it("answers 401 to a session token that does not exist", async () => {
    const cookie = "session=jeton-inconnu";
    const listed = await app.request("/api/builds", { headers: { cookie } });
    expect(listed.status).toBe(401);
    await readJson(listed, unauthorizedSchema);

    const created = await app.request("/api/builds", {
      method: "POST",
      headers: { ...jsonHeaders, cookie },
      body: JSON.stringify({ name: `Sans cookie ${randomUUID()}` }),
    });
    expect(created.status).toBe(401);
    await readJson(created, unauthorizedSchema);
  });

  it("changes nothing when every mutating request is refused", async () => {
    const build = await makeBuild();
    const attached = await makePart("blade");
    const other = await makePart("bit");
    await db.buildPart.create({ data: { buildId: build.id, partId: attached.id } });

    const responses = [
      await app.request(`/api/builds/${String(build.id)}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ name: `Sans cookie ${randomUUID()}`, notes: "Sans cookie" }),
      }),
      await app.request(`/api/builds/${String(build.id)}/parts`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ partId: other.id }),
      }),
      await app.request(`/api/builds/${String(build.id)}/parts/${String(attached.id)}`, { method: "DELETE" }),
      await app.request(`/api/builds/${String(build.id)}`, { method: "DELETE" }),
    ];
    for (const res of responses) expect(res.status).toBe(401);

    const listed = (await readJson(await authed("/api/builds"), listSchema)).find((b) => b.id === build.id);
    expect(listed).toEqual({ id: build.id, name: build.name, notes: null, parts: [attached] });
  });
});

describe("GET /api/builds : seulement les builds de l'utilisateur connecté", () => {
  it("lists the seeded build for me", async () => {
    const body = await readJson(await authed("/api/builds"), listSchema);
    expect(body.filter((build) => build.name === SEED_BUILD.name)).toHaveLength(1);
  });

  it("does not show a build created by alice to me", async () => {
    const hers = await createBuildAs("alice", `Build d'Alice ${randomUUID()}`);
    expect(await listedIds("me")).not.toContain(hers);
  });

  it("does not show my build to alice, nor the seeded build", async () => {
    const mine = await createBuildAs("me", `Build de Moi ${randomUUID()}`);
    const aliceIds = await listedIds("alice");
    expect(aliceIds).not.toContain(mine);

    const aliceBody = await readJson(await authed("/api/builds", {}, "alice"), listSchema);
    expect(aliceBody.some((build) => build.name === SEED_BUILD.name)).toBe(false);
  });

  it("shows each user their own build", async () => {
    const mine = await createBuildAs("me", `Build de Moi ${randomUUID()}`);
    const hers = await createBuildAs("alice", `Build d'Alice ${randomUUID()}`);
    expect(await listedIds("me")).toContain(mine);
    expect(await listedIds("alice")).toContain(hers);
  });
});

describe("POST /api/builds : le build appartient à l'utilisateur connecté (201)", () => {
  it("creates a build for me, which my list shows", async () => {
    const created = await createBuildAs("me", `Build de Moi ${randomUUID()}`);
    expect(await listedIds("me")).toContain(created);
  });

  it("creates a build for alice, which only alice's list shows", async () => {
    const created = await createBuildAs("alice", `Build d'Alice ${randomUUID()}`);
    expect(await listedIds("alice")).toContain(created);
    expect(await listedIds("me")).not.toContain(created);
  });
});
