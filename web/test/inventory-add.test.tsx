import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type Api, type FetchImpl } from "../src/lib/api-client";
import { parts, renderApp, type Part } from "./helpers";

// Forme réelle de GET /api/owned-parts : la pièce est imbriquée sous `part`.
interface OwnedRow {
  id: number;
  partId: number;
  quantity: number;
  part: Part;
}

// Lignes possédées du seed : Dran Sword x1, 3-60 x2, Flat x1, Hells Scythe x1.
const seedRows: OwnedRow[] = [
  { id: 1, partId: 1, quantity: 1, part: { id: 1, kind: "blade", name: "Dran Sword" } },
  { id: 2, partId: 2, quantity: 1, part: { id: 2, kind: "blade", name: "Hells Scythe" } },
  { id: 3, partId: 3, quantity: 2, part: { id: 3, kind: "ratchet", name: "3-60" } },
  { id: 4, partId: 4, quantity: 1, part: { id: 4, kind: "bit", name: "Flat" } },
];

// Catalogue : les pièces de l'aide partagée, plus Shark Edge qui n'a aucune ligne d'inventaire.
const catalogue: Part[] = [...parts, { id: 5, kind: "blade", name: "Shark Edge" }];

interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface AddBody {
  partId: number;
  quantity: number;
}

// Imite GET /api/parts et GET/POST /api/owned-parts. Un POST fusionne dans la ligne existante
// et répond 409 `quantity limit` si le total dépasse 99. `hold` retient la réponse POST tant qu'il n'est pas résolu.
function fakeInventory(initial: OwnedRow[], hold?: Promise<void>): { api: Api; calls: Call[] } {
  const rows = initial.map((row) => ({ ...row }));
  const calls: Call[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);

    if (req.method === "POST") {
      const sent = JSON.parse(await req.text()) as AddBody;
      calls.push({ method: req.method, path: url.pathname, body: sent });
      if (hold !== undefined) await hold;

      const existing = rows.find((row) => row.partId === sent.partId);
      if (existing !== undefined) {
        if (existing.quantity + sent.quantity > 99) {
          return Response.json({ error: "quantity limit" }, { status: 409 });
        }
        existing.quantity += sent.quantity;
        return Response.json(existing, { status: 200 });
      }
      const part = catalogue.find((p) => p.id === sent.partId);
      if (part === undefined) return Response.json({ error: "part not found" }, { status: 404 });
      const row: OwnedRow = { id: rows.length + 1, partId: part.id, quantity: sent.quantity, part };
      rows.push(row);
      return Response.json(row, { status: 201 });
    }

    calls.push({ method: req.method, path: url.pathname, body: undefined });
    if (url.pathname === "/api/parts") return Response.json(catalogue);
    if (url.pathname === "/api/owned-parts") return Response.json(rows);
    return new Response("not found", { status: 404 });
  };
  return { api: createApi("http://localhost", fetchImpl), calls };
}

async function openInventory(initial: OwnedRow[] = seedRows, hold?: Promise<void>) {
  const { api, calls } = fakeInventory(initial, hold);
  const user = userEvent.setup();
  renderApp(api, "/inventory");
  await screen.findByRole("table");
  return { user, calls };
}

// Choisit la pièce dans la liste déroulante, saisit la quantité, puis envoie le formulaire.
async function addToInventory(user: UserEvent, partName: string, quantity: number) {
  await screen.findByRole("option", { name: partName });
  await user.selectOptions(screen.getByRole("combobox", { name: /part/i }), partName);
  const field = screen.getByRole("spinbutton", { name: /quantity/i });
  await user.clear(field);
  await user.type(field, String(quantity));
  await user.click(screen.getByRole("button", { name: /add/i }));
}

// Les textes des cellules d'une ligne du tableau, dans l'ordre des colonnes.
function cellsOf(name: string): (string | null)[] {
  const row = screen.getByRole("row", { name: new RegExp(name) });
  return within(row).getAllByRole("cell").map((cell) => cell.textContent);
}

describe("Inventory add form", () => {
  it("adds to a part already owned and shows the new total", async () => {
    const { user, calls } = await openInventory();
    await addToInventory(user, "Dran Sword", 2);

    await waitFor(() => {
      expect(cellsOf("Dran Sword")).toEqual(["Dran Sword", "Lame", "3"]);
    });
    expect(calls).toContainEqual({ method: "POST", path: "/api/owned-parts", body: { partId: 1, quantity: 2 } });
    // Le chargement initial puis le rafraîchissement après l'ajout.
    expect(calls.filter((c) => c.method === "GET" && c.path === "/api/owned-parts")).toHaveLength(2);
  });

  it("adds a part with no inventory row yet as a new row", async () => {
    const { user } = await openInventory();
    await addToInventory(user, "Shark Edge", 3);

    await waitFor(() => {
      expect(cellsOf("Shark Edge")).toEqual(["Shark Edge", "Lame", "3"]);
    });
    expect(cellsOf("Dran Sword")).toEqual(["Dran Sword", "Lame", "1"]);
  });

  it("shows the API error when the total would go above 99, and leaves the quantity unchanged", async () => {
    const { user } = await openInventory();
    // 3-60 est possédé x2 dans le seed : 2 + 98 = 100.
    await addToInventory(user, "3-60", 98);

    expect(await screen.findByText(/quantity limit/)).toBeInTheDocument();
    expect(cellsOf("3-60")).toEqual(["3-60", "Ratchet", "2"]);
  });

  it("accepts a total of exactly 99 without an error", async () => {
    const { user } = await openInventory();
    // 3-60 est possédé x2 dans le seed : 2 + 97 = 99.
    await addToInventory(user, "3-60", 97);

    await waitFor(() => {
      expect(cellsOf("3-60")).toEqual(["3-60", "Ratchet", "99"]);
    });
    expect(screen.queryByText(/quantity limit/)).not.toBeInTheDocument();
  });

  it("disables the add button while the request is in flight", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const { user, calls } = await openInventory(seedRows, hold);
    await addToInventory(user, "Flat", 1);

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST")).toBe(true);
    });
    const add = screen.getByRole("button", { name: /add/i });
    expect(add).toBeDisabled();

    release();
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
  });
});
