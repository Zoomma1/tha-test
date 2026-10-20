import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type RecordedRequest } from "./helpers";

// Pièces du catalogue de helpers.ts. Le build et ses pièces manquantes sont des données de ce test, pas le seed.
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

const dranSword: BuildPart = { id: 1, kind: "blade", name: "Dran Sword" };
const hellsScythe: BuildPart = { id: 2, kind: "blade", name: "Hells Scythe" };
const threeSixty: BuildPart = { id: 3, kind: "ratchet", name: "3-60" };
const flat: BuildPart = { id: 4, kind: "bit", name: "Flat" };

const addMissingLabel = "Add missing to wishlist";

interface Faults {
  // Statut renvoyé par GET /api/builds/:id/missing.
  missing?: number;
  // Réponse d'erreur de POST /api/wishlist/from-build/:id (statut et message JSON { error }).
  fromBuild?: { status: number; error: string };
}

// Imite GET /api/builds, GET /api/parts, GET /api/builds/:id/missing et POST /api/wishlist/from-build/:id.
// `missingByBuild` donne les pièces absentes de l'inventaire pour chaque build ; un build absent de la table n'en a aucune.
function serverWith(builds: Build[], missingByBuild: Map<number, BuildPart[]>, faults: Faults = {}) {
  const catalogue = partsHandler();

  return fakeApi((req: RecordedRequest) => {
    const { method, path } = req;

    if (method === "GET" && path === "/api/parts") return catalogue(req);
    if (method === "GET" && path === "/api/builds") return Response.json(builds);

    const missing = /^\/api\/builds\/(\d+)\/missing$/.exec(path);
    if (method === "GET" && missing !== null) {
      if (faults.missing !== undefined) return new Response("boom", { status: faults.missing });
      return Response.json(missingByBuild.get(Number(missing[1])) ?? []);
    }

    const fromBuild = /^\/api\/wishlist\/from-build\/(\d+)$/.exec(path);
    if (method === "POST" && fromBuild !== null) {
      if (faults.fromBuild !== undefined) {
        return Response.json({ error: faults.fromBuild.error }, { status: faults.fromBuild.status });
      }
      const added = (missingByBuild.get(Number(fromBuild[1])) ?? []).map((part, index) => ({
        id: index + 1,
        partId: part.id,
        note: "",
        priority: 0,
        part,
      }));
      return Response.json(added, { status: 201 });
    }

    return new Response("not found", { status: 404 });
  });
}

// L'élément de liste du build qui porte le nom donné (son titre) ; ses pièces sont des éléments imbriqués.
function buildItem(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("heading", { name }) !== null);
  if (item === undefined) throw new Error(`no build item is named ${name}`);
  return item;
}

// Nombre d'affichages du nom d'une pièce dans l'élément du build. Les options du composeur ne comptent pas.
function shownIn(item: HTMLElement, partName: string): number {
  return within(item).queryAllByText(new RegExp(partName), { ignore: "option, script, style" }).length;
}

// Laisse arriver au rendu les réponses déjà servies.
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Attend que la page ait demandé les pièces manquantes du build, puis laisse le rendu se faire.
async function settledMissing(requests: RecordedRequest[], buildId: number): Promise<void> {
  await waitFor(() => {
    expect(requests.some((r) => r.method === "GET" && r.path === `/api/builds/${String(buildId)}/missing`)).toBe(true);
  });
  await flush();
}

describe("Builds: missing parts", () => {
  it("lists the parts of a build that are missing from the inventory, under that build", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const { api, requests } = serverWith([night], new Map([[1, [hellsScythe]]]));
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Night build" });
    await settledMissing(requests, 1);

    // Le build affiche chaque pièce une fois ; la pièce manquante s'affiche une seconde fois dans la liste des manquantes.
    expect(shownIn(buildItem("Night build"), "Hells Scythe")).toBe(2);
    expect(shownIn(buildItem("Night build"), "3-60")).toBe(1);
    expect(shownIn(buildItem("Night build"), "Flat")).toBe(1);
  });

  it("shows nothing about missing parts when every part of the build is owned", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const { api, requests } = serverWith([night], new Map());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Night build" });
    await settledMissing(requests, 1);

    expect(screen.queryByRole("button", { name: addMissingLabel })).not.toBeInTheDocument();
    expect(shownIn(buildItem("Night build"), "Hells Scythe")).toBe(1);
    expect(shownIn(buildItem("Night build"), "3-60")).toBe(1);
    expect(shownIn(buildItem("Night build"), "Flat")).toBe(1);
  });

  it("gives the add button only to the build that has missing parts", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const day: Build = { id: 2, name: "Day build", parts: [dranSword, flat] };
    const { api, requests } = serverWith([night, day], new Map([[1, [hellsScythe, threeSixty]]]));
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Night build" });
    await screen.findByRole("heading", { name: "Day build" });
    await settledMissing(requests, 1);
    await settledMissing(requests, 2);

    expect(screen.getAllByRole("button", { name: addMissingLabel })).toHaveLength(1);
    expect(within(buildItem("Night build")).getByRole("button", { name: addMissingLabel })).toBeInTheDocument();
    expect(within(buildItem("Day build")).queryByRole("button", { name: addMissingLabel })).not.toBeInTheDocument();
    expect(shownIn(buildItem("Night build"), "3-60")).toBe(2);
    expect(shownIn(buildItem("Day build"), "Dran Sword")).toBe(1);
  });

  it("adds the missing parts to the wishlist from the build, then confirms it", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const { api, requests } = serverWith([night], new Map([[1, [hellsScythe]]]));
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Night build" });

    await userEvent.click(await within(buildItem("Night build")).findByRole("button", { name: addMissingLabel }));

    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({ method: "POST", path: "/api/wishlist/from-build/1" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).not.toHaveTextContent(/loading/i);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the API error and no confirmation when the missing parts cannot be added", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const { api } = serverWith([night], new Map([[1, [hellsScythe]]]), {
      fromBuild: { status: 404, error: "build not found" },
    });
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Night build" });

    await userEvent.click(await within(buildItem("Night build")).findByRole("button", { name: addMissingLabel }));

    expect(await screen.findByRole("alert")).toHaveTextContent("build not found");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the API error when the missing parts cannot be loaded", async () => {
    const night: Build = { id: 1, name: "Night build", parts: [hellsScythe, threeSixty, flat] };
    const { api } = serverWith([night], new Map(), { missing: 500 });
    renderApp(api, "/builds");

    expect(await screen.findByRole("alert")).toHaveTextContent("500");
  });
});
