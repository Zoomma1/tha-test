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

// Les quatre lignes du seed. Chaque test a son propre serveur factice : rien n'est partagé entre les tests.
const dranSword: CatalogPart = { id: 1, kind: "blade", name: "Dran Sword" };
const hellsScythe: CatalogPart = { id: 2, kind: "blade", name: "Hells Scythe" };
const threeSixty: CatalogPart = { id: 3, kind: "ratchet", name: "3-60" };
const flat: CatalogPart = { id: 4, kind: "bit", name: "Flat" };
const catalogue: CatalogPart[] = [dranSword, hellsScythe, threeSixty, flat];
const seedRows: OwnedRow[] = [
  { id: 1, partId: 1, quantity: 1, part: dranSword },
  { id: 2, partId: 2, quantity: 1, part: hellsScythe },
  { id: 3, partId: 3, quantity: 2, part: threeSixty },
  { id: 4, partId: 4, quantity: 1, part: flat },
];

function isQuantityBody(value: unknown): value is { quantity: number } {
  return typeof value === "object" && value !== null && "quantity" in value && typeof value.quantity === "number";
}

interface Failure {
  status: number;
  error: string;
}

// Une réponse d'erreur forcée pour PATCH ou DELETE ; sans elle, l'API est imitée fidèlement.
interface Faults {
  patch?: Failure;
  remove?: Failure;
}

// Imite GET /api/parts, GET /api/owned-parts, PATCH /api/owned-parts/:id et DELETE /api/owned-parts/:id.
// `patches` et `deletes` gardent les requêtes reçues, pour vérifier ce qui est envoyé.
function serverWith(faults: Faults = {}) {
  let rows: OwnedRow[] = seedRows;
  const patches: { path: string; body: unknown }[] = [];
  const deletes: string[] = [];

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/parts") return Response.json(catalogue);
    if (req.method === "GET" && path === "/api/owned-parts") return Response.json(rows);

    const match = /^\/api\/owned-parts\/(\d+)$/.exec(path);
    if (match !== null && req.method === "PATCH") {
      const body: unknown = JSON.parse(await req.text());
      patches.push({ path, body });
      if (faults.patch !== undefined) {
        return Response.json({ error: faults.patch.error }, { status: faults.patch.status });
      }
      if (!isQuantityBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const id = Number(match[1]);
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return Response.json({ error: "owned part not found" }, { status: 404 });
      const updated: OwnedRow = { ...row, quantity: body.quantity };
      rows = rows.map((r) => (r.id === id ? updated : r));
      return Response.json(updated, { status: 200 });
    }

    if (match !== null && req.method === "DELETE") {
      deletes.push(path);
      if (faults.remove !== undefined) {
        return Response.json({ error: faults.remove.error }, { status: faults.remove.status });
      }
      const id = Number(match[1]);
      rows = rows.filter((r) => r.id !== id);
      return new Response(null, { status: 204 });
    }

    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), patches, deletes };
}

// La ligne du tableau qui affiche le nom donné, une fois la liste chargée.
async function findRow(name: string): Promise<HTMLElement> {
  return screen.findByRole("row", { name: new RegExp(name) });
}

// Remplace la quantité de la ligne par celle donnée, puis enregistre la ligne.
async function saveQuantity(name: string, quantity: string) {
  const input = within(screen.getByRole("row", { name: new RegExp(name) })).getByRole("spinbutton", {
    name: /quantity/i,
  });
  await userEvent.clear(input);
  await userEvent.type(input, quantity);
  await userEvent.click(within(screen.getByRole("row", { name: new RegExp(name) })).getByRole("button", { name: /save/i }));
}

describe("Inventory edit", () => {
  it("shows the new quantity after the row is saved, and sends it with PATCH", async () => {
    const { api, patches } = serverWith();
    renderApp(api, "/inventory");
    await findRow("Dran Sword");

    await saveQuantity("Dran Sword", "3");

    await waitFor(() => {
      expect(within(screen.getByRole("row", { name: /Dran Sword/ })).getByText("3")).toBeInTheDocument();
    });
    expect(patches).toEqual([{ path: "/api/owned-parts/1", body: { quantity: 3 } }]);
  });

  it("shows the API error when saving the quantity fails", async () => {
    const { api } = serverWith({ patch: { status: 404, error: "owned part not found" } });
    renderApp(api, "/inventory");
    await findRow("Dran Sword");

    await saveQuantity("Dran Sword", "3");

    expect(await screen.findByRole("alert")).toHaveTextContent("owned part not found");
  });

  it("removes the row after it is deleted, and keeps the other rows", async () => {
    const { api, deletes } = serverWith();
    renderApp(api, "/inventory");
    const row = await findRow("Hells Scythe");

    await userEvent.click(within(row).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.queryByRole("row", { name: /Hells Scythe/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("row", { name: /Dran Sword/ })).toBeInTheDocument();
    expect(deletes).toEqual(["/api/owned-parts/2"]);
  });

  it("shows the API error when deleting the row fails, and keeps the row", async () => {
    const { api } = serverWith({ remove: { status: 404, error: "owned part not found" } });
    renderApp(api, "/inventory");
    const row = await findRow("Hells Scythe");

    await userEvent.click(within(row).getByRole("button", { name: /delete/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("owned part not found");
    expect(screen.getByRole("row", { name: /Hells Scythe/ })).toBeInTheDocument();
  });
});
