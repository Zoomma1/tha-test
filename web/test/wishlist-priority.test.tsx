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

interface WishlistRow {
  id: number;
  partId: number;
  note: string;
  priority: number;
  part: CatalogPart;
}

// Catalogue du test. Shark Edge et Leon Claw ne sont pas sur la liste d'achats de départ.
const wizardArrow: CatalogPart = { id: 5, kind: "blade", name: "Wizard Arrow" };
const rush: CatalogPart = { id: 6, kind: "bit", name: "Rush" };
const leonClaw: CatalogPart = { id: 7, kind: "blade", name: "Leon Claw" };
const sharkEdge: CatalogPart = { id: 8, kind: "blade", name: "Shark Edge" };
const catalogue: CatalogPart[] = [wizardArrow, rush, leonClaw, sharkEdge];

// Éléments de départ, dans un ordre d'arrivée qui n'est ni croissant ni décroissant en priorité.
const seedRows: WishlistRow[] = [
  { id: 1, partId: wizardArrow.id, note: "Pour une build défensive", priority: 1, part: wizardArrow },
  { id: 2, partId: rush.id, note: "À tester en attaque", priority: 4, part: rush },
  { id: 3, partId: leonClaw.id, note: "Pour le combo", priority: 0, part: leonClaw },
];

const listedNames = [wizardArrow.name, rush.name, leonClaw.name, sharkEdge.name];

function isAddBody(value: unknown): value is { partId: number; note: string; priority: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "partId" in value &&
    "note" in value &&
    "priority" in value &&
    typeof value.partId === "number" &&
    typeof value.note === "string" &&
    typeof value.priority === "number"
  );
}

// Imite GET /api/parts, GET /api/wishlist et POST /api/wishlist avec un état propre à chaque test.
// Le POST renvoie l'élément créé (201) et l'ajoute à la liste, comme l'API.
function serverWith(rows: WishlistRow[] = seedRows) {
  let items: WishlistRow[] = rows.map((r) => ({ ...r }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  const posts: unknown[] = [];

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/parts") return Response.json(catalogue);
    if (req.method === "GET" && path === "/api/wishlist") return Response.json(items);
    if (req.method === "POST" && path === "/api/wishlist") {
      const body: unknown = JSON.parse(await req.text());
      posts.push(body);
      if (!isAddBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const part = catalogue.find((p) => p.id === body.partId);
      if (part === undefined) return Response.json({ error: "unknown part" }, { status: 404 });
      const created: WishlistRow = { id: nextId, partId: part.id, note: body.note, priority: body.priority, part };
      nextId += 1;
      items = [...items, created];
      return Response.json(created, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), posts };
}

// La ligne de liste qui affiche le nom donné.
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no list item shows ${name}`);
  return row;
}

// Vrai si la ligne affiche ce nombre seul, c'est-à-dire sans faire partie d'un autre nombre.
// Les noms et les notes du test ne contiennent aucun chiffre.
function showsPriority(row: HTMLElement, priority: number): boolean {
  return new RegExp(`(^|\\D)${String(priority)}(\\D|$)`).test(row.textContent);
}

// Les pièces de la liste, dans l'ordre affiché.
function displayedOrder(): string[] {
  return screen
    .getAllByRole("listitem")
    .flatMap((item) => {
      const name = listedNames.find((n) => item.textContent.includes(n));
      return name === undefined ? [] : [name];
    });
}

describe("Wishlist priority", () => {
  it("shows the priority of each item next to its part and note", async () => {
    const { api } = serverWith();
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    expect(showsPriority(rowFor("Wizard Arrow"), 1)).toBe(true);
    expect(showsPriority(rowFor("Rush"), 4)).toBe(true);
    expect(showsPriority(rowFor("Leon Claw"), 0)).toBe(true);
  });

  it("lists the items from the highest priority to the lowest, whatever order the API sends them", async () => {
    const { api } = serverWith();
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    expect(displayedOrder()).toEqual(["Rush", "Wizard Arrow", "Leon Claw"]);
  });

  it("offers the priorities 0 to 5 in the add form", async () => {
    const { api } = serverWith();
    renderApp(api, "/wishlist");

    const priority = await screen.findByRole("combobox", { name: /priority/i });
    const values = within(priority)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(values).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("adds an item: sends partId, note and the chosen priority, then lists it at its priority", async () => {
    const { api, posts } = serverWith();
    renderApp(api, "/wishlist");
    await screen.findByRole("option", { name: "Shark Edge" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /part/i }), "Shark Edge");
    await userEvent.type(screen.getByRole("textbox", { name: /note/i }), "Pour la finale");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /priority/i }), "5");
    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(showsPriority(rowFor("Shark Edge"), 5)).toBe(true);
    });
    expect(posts).toEqual([{ partId: sharkEdge.id, note: "Pour la finale", priority: 5 }]);
    expect(displayedOrder()).toEqual(["Shark Edge", "Rush", "Wizard Arrow", "Leon Claw"]);
  });
});
