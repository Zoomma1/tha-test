import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type Handler } from "./helpers";

// Forme de GET /api/builds : chaque build porte ses pièces à plat (`id`, `kind`, `name`).
interface BuildPart {
  id: number;
  kind: "blade" | "ratchet" | "bit";
  name: string;
}

interface Fixture {
  id: number;
  name: string;
  parts: BuildPart[];
  // Ce que GET /api/builds/:id/missing renvoie pour ce build.
  missing: BuildPart[];
}

// Pièces du test. Shark Edge et Leon Claw ne sont possédées nulle part ; 3-60 et Flat le sont dans le seed.
const sharkEdge: BuildPart = { id: 5, kind: "blade", name: "Shark Edge" };
const leonClaw: BuildPart = { id: 6, kind: "blade", name: "Leon Claw" };
const threeSixty: BuildPart = { id: 3, kind: "ratchet", name: "3-60" };
const flat: BuildPart = { id: 4, kind: "bit", name: "Flat" };
const dranSword: BuildPart = { id: 1, kind: "blade", name: "Dran Sword" };

const fixtures: Fixture[] = [
  { id: 1, name: "Shark Night", parts: [sharkEdge, threeSixty], missing: [sharkEdge] },
  { id: 2, name: "Full Set", parts: [dranSword, threeSixty, flat], missing: [] },
  { id: 3, name: "Leon Night", parts: [leonClaw, flat], missing: [leonClaw] },
];

interface Faults {
  // Statut renvoyé par GET /api/builds/:id/missing.
  missing?: number;
  // Réponse à POST /api/wishlist/from-build/:id : statut, et corps `{ error }` si l'API en renvoie un.
  fromBuild?: { status: number; body?: { error: string } };
}

function fixtureById(id: number): Fixture | undefined {
  return fixtures.find((f) => f.id === id);
}

// Imite les routes utilisées par la page des builds, avec les pièces manquantes de chaque build.
function serverWith(faults: Faults = {}): Handler {
  return (req) => {
    const { method, path } = req;

    if (method === "GET" && path === "/api/parts") return partsHandler()(req);
    if (method === "GET" && path === "/api/wishlist") return Response.json([]);
    if (method === "GET" && path === "/api/builds") {
      return Response.json(fixtures.map(({ id, name, parts }) => ({ id, name, parts })));
    }

    const missing = /^\/api\/builds\/(\d+)\/missing$/.exec(path);
    if (method === "GET" && missing) {
      if (faults.missing !== undefined) return new Response("boom", { status: faults.missing });
      const fixture = fixtureById(Number(missing[1]));
      if (fixture === undefined) return Response.json({ error: "build not found" }, { status: 404 });
      return Response.json(fixture.missing);
    }

    const fromBuild = /^\/api\/wishlist\/from-build\/(\d+)$/.exec(path);
    if (method === "POST" && fromBuild) {
      const fault = faults.fromBuild;
      if (fault !== undefined) {
        return fault.body === undefined
          ? new Response("boom", { status: fault.status })
          : Response.json(fault.body, { status: fault.status });
      }
      const fixture = fixtureById(Number(fromBuild[1]));
      if (fixture === undefined) return Response.json({ error: "build not found" }, { status: 404 });
      const added = fixture.missing.map((part, i) => ({ id: i + 1, partId: part.id, note: "", priority: 0, part }));
      return Response.json(added, { status: 201 });
    }

    return new Response("not found", { status: 404 });
  };
}

// L'élément de liste du build qui porte le nom donné (son titre) ; ses pièces sont des éléments imbriqués.
function buildItem(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("heading", { name }) !== null);
  if (item === undefined) throw new Error(`no build item is named ${name}`);
  return item;
}

// Nombre d'éléments de texte exactement égaux au nom, dans le build. Les options du composeur ne comptent pas :
// elles listent aussi les noms de pièces.
function nameCount(item: HTMLElement, name: string): number {
  return within(item)
    .queryAllByText(name)
    .filter((el) => el.closest("select") === null).length;
}

// Attend que les pièces manquantes de Shark Night et de Leon Night soient affichées, pour que l'absence
// d'affichage sur les autres builds soit vérifiée une fois le chargement terminé.
async function settle() {
  await waitFor(() => {
    expect(nameCount(buildItem("Shark Night"), "Shark Edge")).toBe(2);
    expect(nameCount(buildItem("Leon Night"), "Leon Claw")).toBe(2);
  });
}

// Confirmation : message de statut qui n'est pas l'indicateur de chargement. Son texte n'est pas figé par la tâche.
function confirmations(): HTMLElement[] {
  return screen.queryAllByRole("status").filter((el) => !/loading/i.test(el.textContent));
}

describe("Builds: missing parts", () => {
  it("lists a missing part under its build, next to the parts the build already has", async () => {
    const { api } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Shark Night" });

    await waitFor(() => {
      // Une fois dans la liste des pièces du build, une fois dans la liste des manquantes.
      expect(nameCount(buildItem("Shark Night"), "Shark Edge")).toBe(2);
    });
  });

  it("does not list an owned part of the build as missing", async () => {
    const { api } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Shark Night" });
    await settle();

    // 3-60 est dans le build, mais pas dans ses manquantes : elle n'apparaît qu'une fois.
    expect(nameCount(buildItem("Shark Night"), "3-60")).toBe(1);
  });

  it("keeps the missing parts of each build apart", async () => {
    const { api } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Leon Night" });
    await settle();

    expect(nameCount(buildItem("Leon Night"), "Leon Claw")).toBe(2);
    expect(nameCount(buildItem("Shark Night"), "Leon Claw")).toBe(0);
    expect(nameCount(buildItem("Leon Night"), "Shark Edge")).toBe(0);
  });

  it("shows nothing about missing parts when every part of the build is owned", async () => {
    const { api } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Full Set" });
    await settle();

    const item = buildItem("Full Set");
    expect(within(item).queryByRole("button", { name: "Add missing to wishlist" })).not.toBeInTheDocument();
    expect(nameCount(item, "Dran Sword")).toBe(1);
    expect(nameCount(item, "3-60")).toBe(1);
    expect(nameCount(item, "Flat")).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requests the missing parts of each build from the API", async () => {
    const { api, requests } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Shark Night" });
    await settle();

    const missingPaths = requests
      .filter((r) => r.method === "GET" && r.path.endsWith("/missing"))
      .map((r) => r.path);
    expect(new Set(missingPaths)).toEqual(
      new Set(["/api/builds/1/missing", "/api/builds/2/missing", "/api/builds/3/missing"]),
    );
  });

  it("adds the missing parts of the build to the wishlist with its button, and confirms it", async () => {
    const { api, requests } = fakeApi(serverWith());
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Leon Night" });
    await settle();

    await userEvent.click(within(buildItem("Leon Night")).getByRole("button", { name: "Add missing to wishlist" }));

    await waitFor(() => {
      expect(confirmations()).toHaveLength(1);
    });
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ method: "POST", path: "/api/wishlist/from-build/3" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the status of the API when the missing parts cannot be loaded", async () => {
    const { api } = fakeApi(serverWith({ missing: 500 }));
    renderApp(api, "/builds");

    expect(await screen.findByRole("alert")).toHaveTextContent("500");
  });

  it("shows the status of the API and confirms nothing when the parts cannot be added to the wishlist", async () => {
    const { api } = fakeApi(serverWith({ fromBuild: { status: 500 } }));
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Leon Night" });
    await settle();

    await userEvent.click(within(buildItem("Leon Night")).getByRole("button", { name: "Add missing to wishlist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("500");
    expect(confirmations()).toHaveLength(0);
  });

  it("shows the message of the API when it refuses the build", async () => {
    const { api } = fakeApi(serverWith({ fromBuild: { status: 404, body: { error: "build not found" } } }));
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Leon Night" });
    await settle();

    await userEvent.click(within(buildItem("Leon Night")).getByRole("button", { name: "Add missing to wishlist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("build not found");
    expect(confirmations()).toHaveLength(0);
  });
});
