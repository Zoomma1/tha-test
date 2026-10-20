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

interface OwnedRow {
  id: number;
  partId: number;
  quantity: number;
  part: CatalogPart;
}

// Catalogue du test. Shark Edge et Leon Claw n'ont aucune ligne d'inventaire dans le seed.
const flat: CatalogPart = { id: 4, kind: "bit", name: "Flat" };
const sharkEdge: CatalogPart = { id: 5, kind: "blade", name: "Shark Edge" };
const leonClaw: CatalogPart = { id: 6, kind: "blade", name: "Leon Claw" };
const catalogue: CatalogPart[] = [flat, sharkEdge, leonClaw];

function isAddBody(value: unknown): value is { partId: number; quantity: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "partId" in value &&
    "quantity" in value &&
    typeof value.partId === "number" &&
    typeof value.quantity === "number"
  );
}

// Imite GET /api/parts, GET /api/owned-parts et POST /api/owned-parts avec un état propre à chaque test.
// Le POST refuse un total au-delà de 99 par 409 `quantity limit`, comme l'API.
// `gate` retient la réponse au POST tant qu'il n'est pas résolu, pour observer l'envoi en cours.
function serverWith(gate?: Promise<void>) {
  let rows: OwnedRow[] = [{ id: 1, partId: flat.id, quantity: 1, part: flat }];
  let nextId = 2;
  const posts: unknown[] = [];

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/parts") return Response.json(catalogue);
    if (req.method === "GET" && path === "/api/owned-parts") return Response.json(rows);
    if (req.method === "POST" && path === "/api/owned-parts") {
      if (gate !== undefined) await gate;
      const body: unknown = JSON.parse(await req.text());
      posts.push(body);
      if (!isAddBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const part = catalogue.find((p) => p.id === body.partId);
      if (part === undefined) return Response.json({ error: "unknown part" }, { status: 404 });
      const existing = rows.find((r) => r.partId === body.partId);
      if (existing === undefined) {
        const created: OwnedRow = { id: nextId, partId: part.id, quantity: body.quantity, part };
        nextId += 1;
        rows = [...rows, created];
        return Response.json(created, { status: 201 });
      }
      const total = existing.quantity + body.quantity;
      if (total > 99) return Response.json({ error: "quantity limit" }, { status: 409 });
      existing.quantity = total;
      return Response.json(existing, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), posts };
}

// Choisit la pièce et la quantité dans le formulaire, puis envoie.
async function addPart(name: string, quantity: number) {
  await screen.findByRole("option", { name });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /part/i }), name);
  const input = screen.getByRole("spinbutton", { name: /quantity/i });
  await userEvent.clear(input);
  await userEvent.type(input, String(quantity));
  await userEvent.click(screen.getByRole("button", { name: /add/i }));
}

// Les cellules de la ligne du tableau qui affiche le nom donné.
function rowCells(name: string): (string | null)[] {
  const row = screen.getByRole("row", { name: new RegExp(name) });
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("Inventory add", () => {
  it("offers every catalogue part in the part dropdown", async () => {
    const { api } = serverWith();
    renderApp(api, "/inventory");
    await screen.findByRole("option", { name: "Leon Claw" });

    const names = within(screen.getByRole("combobox", { name: /part/i }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(expect.arrayContaining(catalogue.map((part) => part.name)));
  });

  it("limits the quantity field to 1 to 99", async () => {
    const { api } = serverWith();
    renderApp(api, "/inventory");
    const input = await screen.findByRole("spinbutton", { name: /quantity/i });
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "99");
  });

  it("adds a part not owned yet: sends partId and quantity, then lists it with that quantity", async () => {
    const { api, posts } = serverWith();
    renderApp(api, "/inventory");

    await addPart("Shark Edge", 2);

    await waitFor(() => {
      expect(rowCells("Shark Edge")).toEqual(["Shark Edge", "Lame", "2"]);
    });
    expect(posts).toEqual([{ partId: sharkEdge.id, quantity: 2 }]);
  });

  it("adding a part already owned increases its displayed quantity without a second row", async () => {
    const { api } = serverWith();
    renderApp(api, "/inventory");
    await screen.findByRole("row", { name: /Flat/ });

    await addPart("Flat", 2);

    await waitFor(() => {
      expect(rowCells("Flat")).toEqual(["Flat", "Bit", "3"]);
    });
    expect(screen.getAllByRole("row", { name: /Flat/ })).toHaveLength(1);
  });

  it("shows the API error when the total would exceed 99, and keeps the quantity", async () => {
    const { api } = serverWith();
    renderApp(api, "/inventory");

    await addPart("Shark Edge", 99);
    await waitFor(() => {
      expect(rowCells("Shark Edge")).toEqual(["Shark Edge", "Lame", "99"]);
    });

    await addPart("Shark Edge", 2);

    expect(await screen.findByRole("alert")).toHaveTextContent("quantity limit");
    expect(rowCells("Shark Edge")).toEqual(["Shark Edge", "Lame", "99"]);
  });

  it("disables the submit button while the request is pending, and enables it again after", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const { api } = serverWith(gate);
    renderApp(api, "/inventory");

    await addPart("Leon Claw", 1);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
    });

    release();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add/i })).toBeEnabled();
    });
    await waitFor(() => {
      expect(rowCells("Leon Claw")).toEqual(["Leon Claw", "Lame", "1"]);
    });
  });
});
