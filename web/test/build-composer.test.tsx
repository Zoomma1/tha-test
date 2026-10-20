import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type FetchImpl } from "../src/lib/api-client";
import { renderApp } from "./helpers";

interface CatalogPart {
  id: number;
  kind: "blade" | "ratchet" | "bit";
  name: string;
}

interface BuildPart {
  id: number;
  kind: "blade" | "ratchet" | "bit";
  name: string;
}

interface Build {
  id: number;
  name: string;
  parts: BuildPart[];
}

// Catalogue du test. Aucune de ces pièces n'est possédée dans le seed, et le seed n'a aucun build
// qui les contienne : chaque test crée son propre build et repart d'un build vide.
const sharkEdge: CatalogPart = { id: 5, kind: "blade", name: "Shark Edge" };
const leonClaw: CatalogPart = { id: 6, kind: "blade", name: "Leon Claw" };
const threeSixty: CatalogPart = { id: 3, kind: "ratchet", name: "3-60" };
const flat: CatalogPart = { id: 4, kind: "bit", name: "Flat" };
const catalogue: CatalogPart[] = [sharkEdge, leonClaw, threeSixty, flat];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNameBody(value: unknown): value is { name: string } {
  return isObject(value) && typeof value.name === "string";
}

function isAddBody(value: unknown): value is { partId: number } {
  return isObject(value) && typeof value.partId === "number";
}

interface Faults {
  // Statut renvoyé par GET /api/parts (la page en a besoin pour le composeur).
  parts?: number;
  // Statut renvoyé par POST /api/builds.
  createBuild?: number;
  // Statut renvoyé par POST /api/builds/:id/parts.
  addPart?: number;
  // Retient la réponse à GET /api/parts tant qu'il n'est pas résolu.
  partsGate?: Promise<void>;
}

// Imite GET et POST /api/builds, GET /api/parts et POST /api/builds/:id/parts avec un état propre à chaque test.
// Le POST des pièces refuse un second élément du même type par 409 `slot taken`, comme l'API.
function serverWith(faults: Faults = {}) {
  let builds: Build[] = [];
  let nextId = 1;

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;

    if (req.method === "GET" && path === "/api/parts") {
      if (faults.partsGate !== undefined) await faults.partsGate;
      if (faults.parts !== undefined) return new Response("boom", { status: faults.parts });
      return Response.json(catalogue);
    }

    if (req.method === "GET" && path === "/api/builds") return Response.json(builds);

    if (req.method === "POST" && path === "/api/builds") {
      if (faults.createBuild !== undefined) return new Response("boom", { status: faults.createBuild });
      const body: unknown = JSON.parse(await req.text());
      if (!isNameBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const created: Build = { id: nextId, name: body.name, parts: [] };
      nextId += 1;
      builds = [...builds, created];
      return Response.json(created, { status: 201 });
    }

    const match = /^\/api\/builds\/(\d+)\/parts$/.exec(path);
    if (req.method === "POST" && match) {
      if (faults.addPart !== undefined) return new Response("boom", { status: faults.addPart });
      const build = builds.find((b) => b.id === Number(match[1]));
      if (build === undefined) return Response.json({ error: "build not found" }, { status: 404 });
      const body: unknown = JSON.parse(await req.text());
      if (!isAddBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const part = catalogue.find((p) => p.id === body.partId);
      if (part === undefined) return Response.json({ error: "part not found" }, { status: 404 });
      if (build.parts.some((p) => p.kind === part.kind)) {
        return Response.json({ error: "slot taken" }, { status: 409 });
      }
      build.parts = [...build.parts, { id: part.id, kind: part.kind, name: part.name }];
      return Response.json(build, { status: 201 });
    }

    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl) };
}

// Crée un build par le formulaire, puis attend qu'il apparaisse dans la liste.
async function createBuild(name: string) {
  await userEvent.type(screen.getByRole("textbox", { name: /name/i }), name);
  await userEvent.click(screen.getByRole("button", { name: /create/i }));
  await screen.findByRole("heading", { name });
}

// L'élément de liste du build qui porte le nom donné (son titre) ; ses pièces sont des éléments imbriqués.
function buildItem(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("heading", { name }) !== null);
  if (item === undefined) throw new Error(`no build item is named ${name}`);
  return item;
}

// Les textes des éléments de liste imbriqués du build, pièces comprises.
function listedTexts(name: string): (string | null)[] {
  return within(buildItem(name))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

// Choisit la pièce dans le composeur du build donné, puis l'ajoute à ce build.
async function addToBuild(buildName: string, partName: string) {
  const item = buildItem(buildName);
  const combobox = within(item).getByRole("combobox", { name: /part/i });
  await within(combobox).findByRole("option", { name: partName });
  await userEvent.selectOptions(combobox, partName);
  await userEvent.click(within(item).getByRole("button", { name: /add/i }));
}

describe("Build composer", () => {
  it("creates a build: it appears in the list under the typed name", async () => {
    const { api } = serverWith();
    renderApp(api, "/builds");

    await createBuild("Shark Night");

    expect(screen.getByRole("heading", { name: "Shark Night" })).toBeInTheDocument();
    expect(screen.queryByText("No build yet")).not.toBeInTheDocument();
  });

  it("adds a part to a build: it is listed under that build", async () => {
    const { api } = serverWith();
    renderApp(api, "/builds");
    await createBuild("Shark Night");

    await addToBuild("Shark Night", "Shark Edge");

    await waitFor(() => {
      expect(listedTexts("Shark Night")).toContain("Shark Edge");
    });
  });

  it("shows slot taken when a part of a type the build already has is added", async () => {
    const { api } = serverWith();
    renderApp(api, "/builds");
    await createBuild("Shark Night");
    await addToBuild("Shark Night", "Shark Edge");
    await waitFor(() => {
      expect(listedTexts("Shark Night")).toContain("Shark Edge");
    });

    await addToBuild("Shark Night", "Leon Claw");

    expect(await screen.findByRole("alert")).toHaveTextContent("slot taken");
    expect(listedTexts("Shark Night")).not.toContain("Leon Claw");
  });

  it("accepts parts of different types in the same build", async () => {
    const { api } = serverWith();
    renderApp(api, "/builds");
    await createBuild("Shark Night");

    await addToBuild("Shark Night", "Shark Edge");
    await waitFor(() => {
      expect(listedTexts("Shark Night")).toContain("Shark Edge");
    });
    await addToBuild("Shark Night", "3-60");
    await waitFor(() => {
      expect(listedTexts("Shark Night")).toContain("3-60");
    });
    await addToBuild("Shark Night", "Flat");
    await waitFor(() => {
      expect(listedTexts("Shark Night")).toContain("Flat");
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Loading while the parts needed by the composer are requested", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const { api } = serverWith({ partsGate: gate });
    renderApp(api, "/builds");

    expect(await screen.findByRole("status")).toHaveTextContent("Loading");

    release();

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("shows an error when the parts cannot be loaded", async () => {
    const { api } = serverWith({ parts: 500 });
    renderApp(api, "/builds");

    expect(await screen.findByRole("alert")).toHaveTextContent("500");
  });

  it("shows an error and creates nothing when the build cannot be created", async () => {
    const { api } = serverWith({ createBuild: 500 });
    renderApp(api, "/builds");

    await userEvent.type(screen.getByRole("textbox", { name: /name/i }), "Shark Night");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shark Night" })).not.toBeInTheDocument();
  });

  it("shows an error and does not list the part when the part cannot be added", async () => {
    const { api } = serverWith({ addPart: 500 });
    renderApp(api, "/builds");
    await createBuild("Shark Night");

    await addToBuild("Shark Night", "Shark Edge");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(listedTexts("Shark Night")).not.toContain("Shark Edge");
  });
});
