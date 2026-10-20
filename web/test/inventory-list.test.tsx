import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, type Handler } from "./helpers";

// Forme réelle de GET /api/owned-parts : la pièce est imbriquée sous `part`.
// Lignes possédées du seed : nom, type affiché (libellés de la page Parts) et quantité.
interface OwnedRow {
  id: number;
  partId: number;
  quantity: number;
  part: { id: number; kind: "blade" | "ratchet" | "bit"; name: string };
}

const seedRows: OwnedRow[] = [
  { id: 1, partId: 1, quantity: 1, part: { id: 1, kind: "blade", name: "Dran Sword" } },
  { id: 2, partId: 2, quantity: 1, part: { id: 2, kind: "blade", name: "Hells Scythe" } },
  { id: 3, partId: 3, quantity: 2, part: { id: 3, kind: "ratchet", name: "3-60" } },
  { id: 4, partId: 4, quantity: 1, part: { id: 4, kind: "bit", name: "Flat" } },
];

// Imite GET /api/owned-parts : la liste donnée, ou une erreur 500 si on le demande.
function ownedHandler(rows: OwnedRow[] = seedRows): Handler {
  return ({ path }) => {
    if (path !== "/api/owned-parts") return new Response("not found", { status: 404 });
    return Response.json(rows);
  };
}

describe("Inventory", () => {
  it("lists the four seed rows with name, type and quantity, after a loading state", async () => {
    const { api } = fakeApi(ownedHandler());
    renderApp(api, "/inventory");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    const expected: [name: string, type: string, quantity: string][] = [
      ["Dran Sword", "Lame", "1"],
      ["Hells Scythe", "Lame", "1"],
      ["3-60", "Ratchet", "2"],
      ["Flat", "Bit", "1"],
    ];
    for (const [name, type, quantity] of expected) {
      const row = await screen.findByRole("row", { name: new RegExp(name) });
      expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([name, type, quantity]);
    }
    expect(screen.getAllByRole("cell")).toHaveLength(12);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("requests the owned parts from the API", async () => {
    const { api, requests } = fakeApi(ownedHandler());
    renderApp(api, "/inventory");
    await screen.findByRole("row", { name: /Dran Sword/ });
    // La liste déroulante du formulaire charge aussi GET /api/parts : on ne compte que les lignes possédées.
    const ownedRequests = requests.filter((r) => r.method === "GET" && r.path === "/api/owned-parts");
    expect(ownedRequests).toHaveLength(1);
    expect(ownedRequests[0]).toMatchObject({ method: "GET", path: "/api/owned-parts" });
  });

  it("shows No part owned yet when the list is empty", async () => {
    const { api } = fakeApi(ownedHandler([]));
    renderApp(api, "/inventory");
    expect(await screen.findByText("No part owned yet")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a generic error with the status on 500", async () => {
    const { api } = fakeApi(() => new Response("boom", { status: 500 }));
    renderApp(api, "/inventory");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
  });

  it("shows an unreachable-server error when the request rejects", async () => {
    const { api } = fakeApi(() => Promise.reject(new Error("offline")));
    renderApp(api, "/inventory");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
