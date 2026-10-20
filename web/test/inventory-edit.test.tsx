import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type FetchImpl } from "../src/lib/api-client";
import { parts, renderApp } from "./helpers";

interface OwnedRow {
  id: number;
  partId: number;
  quantity: number;
  part: { id: number; kind: "blade" | "ratchet" | "bit"; name: string };
}

// Lignes possédées du seed. L'id de la ligne sert d'identifiant dans l'URL : /api/owned-parts/<id>.
const seedRows: OwnedRow[] = [
  { id: 1, partId: 1, quantity: 1, part: { id: 1, kind: "blade", name: "Dran Sword" } },
  { id: 2, partId: 2, quantity: 1, part: { id: 2, kind: "blade", name: "Hells Scythe" } },
  { id: 3, partId: 3, quantity: 2, part: { id: 3, kind: "ratchet", name: "3-60" } },
  { id: 4, partId: 4, quantity: 1, part: { id: 4, kind: "bit", name: "Flat" } },
];

function isQuantityBody(value: unknown): value is { quantity: number } {
  return typeof value === "object" && value !== null && "quantity" in value && typeof value.quantity === "number";
}

// Imite GET /api/parts, GET /api/owned-parts, PATCH et DELETE /api/owned-parts/:id avec un état propre à chaque test.
// `fail` remplace la réponse des PATCH et DELETE, pour observer l'erreur de l'API.
function serverWith(fail?: () => Response) {
  let rows: OwnedRow[] = seedRows;
  const patches: { path: string; body: unknown }[] = [];
  const deletes: string[] = [];

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/parts") return Response.json(parts);
    if (req.method === "GET" && path === "/api/owned-parts") return Response.json(rows);

    const id = /^\/api\/owned-parts\/(\d+)$/.exec(path)?.[1];
    if (id === undefined) return new Response("not found", { status: 404 });
    const row = rows.find((r) => r.id === Number(id));

    if (req.method === "PATCH") {
      const body: unknown = JSON.parse(await req.text());
      patches.push({ path, body });
      if (fail !== undefined) return fail();
      if (row === undefined) return Response.json({ error: "owned part not found" }, { status: 404 });
      if (!isQuantityBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const updated: OwnedRow = { ...row, quantity: body.quantity };
      rows = rows.map((r) => (r.id === updated.id ? updated : r));
      return Response.json(updated, { status: 200 });
    }
    if (req.method === "DELETE") {
      deletes.push(path);
      if (fail !== undefined) return fail();
      if (row === undefined) return Response.json({ error: "owned part not found" }, { status: 404 });
      rows = rows.filter((r) => r.id !== row.id);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), patches, deletes };
}

// La ligne du tableau qui affiche le nom donné.
function rowFor(name: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(name) });
}

describe("Inventory edit", () => {
  it("gives every row a quantity field and Save and Delete buttons named after the part", async () => {
    const { api } = serverWith();
    renderApp(api, "/inventory");

    for (const name of ["Dran Sword", "Hells Scythe", "3-60", "Flat"]) {
      const row = await screen.findByRole("row", { name: new RegExp(name) });
      expect(within(row).getByRole("spinbutton", { name: `Quantity of ${name}` })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: `Save ${name}` })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: `Delete ${name}` })).toBeInTheDocument();
    }
  });

  it("saves a new quantity: sends it to the row's URL and shows it in the row", async () => {
    const { api, patches } = serverWith();
    renderApp(api, "/inventory");

    const field = await screen.findByRole("spinbutton", { name: "Quantity of Dran Sword" });
    await userEvent.clear(field);
    await userEvent.type(field, "5");
    await userEvent.click(screen.getByRole("button", { name: "Save Dran Sword" }));

    await waitFor(() => {
      expect(within(rowFor("Dran Sword")).getByRole("cell", { name: "5" })).toBeInTheDocument();
    });
    expect(patches).toEqual([{ path: "/api/owned-parts/1", body: { quantity: 5 } }]);
  });

  it("removes a row when its Delete button is pressed, and leaves the other rows", async () => {
    const { api, deletes } = serverWith();
    renderApp(api, "/inventory");

    await userEvent.click(await screen.findByRole("button", { name: "Delete Flat" }));

    await waitFor(() => {
      expect(screen.queryByRole("row", { name: /Flat/ })).not.toBeInTheDocument();
    });
    expect(deletes).toEqual(["/api/owned-parts/4"]);
    expect(screen.getByRole("row", { name: /Dran Sword/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /3-60/ })).toBeInTheDocument();
  });

  it("shows the API error when the save fails, and keeps the previous quantity", async () => {
    const { api } = serverWith(() => Response.json({ error: "owned part not found" }, { status: 404 }));
    renderApp(api, "/inventory");

    const field = await screen.findByRole("spinbutton", { name: "Quantity of Dran Sword" });
    await userEvent.clear(field);
    await userEvent.type(field, "5");
    await userEvent.click(screen.getByRole("button", { name: "Save Dran Sword" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("owned part not found");
    expect(within(rowFor("Dran Sword")).getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("shows the API error when the delete fails, and keeps the row", async () => {
    const { api } = serverWith(() => Response.json({ error: "owned part not found" }, { status: 404 }));
    renderApp(api, "/inventory");

    await userEvent.click(await screen.findByRole("button", { name: "Delete Flat" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("owned part not found");
    expect(rowFor("Flat")).toBeInTheDocument();
  });
});
