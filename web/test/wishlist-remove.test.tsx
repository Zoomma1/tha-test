import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, type Handler } from "./helpers";

// Éléments du seed de la wishlist : Wizard Arrow (id 1) et Rush (id 2).
interface WishlistRow {
  id: number;
  partId: number;
  note: string;
  part: { id: number; kind: "blade" | "ratchet" | "bit"; name: string };
}

const seedRows: WishlistRow[] = [
  {
    id: 1,
    partId: 5,
    note: "Pour une build défensive",
    part: { id: 5, kind: "blade", name: "Wizard Arrow" },
  },
  {
    id: 2,
    partId: 6,
    note: "À tester en attaque",
    part: { id: 6, kind: "bit", name: "Rush" },
  },
];

// Imite GET et DELETE /api/wishlist/:id avec un état propre à chaque test.
// Un DELETE réussi retire la ligne (204) ; `deleteFails` fait répondre 500 au DELETE.
function wishlistHandler(deleteFails = false): Handler {
  let rows = seedRows.map((r) => ({ ...r }));
  return ({ method, path }) => {
    if (method === "GET" && path === "/api/wishlist") return Response.json(rows);
    const match = /^\/api\/wishlist\/(\d+)$/.exec(path);
    if (method === "DELETE" && match) {
      if (deleteFails) return new Response("boom", { status: 500 });
      const id = Number(match[1]);
      rows = rows.filter((r) => r.id !== id);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };
}

// La ligne de liste qui affiche le nom donné.
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no list item shows ${name}`);
  return row;
}

describe("Wishlist remove", () => {
  it("removes the chosen item from the list once it is deleted", async () => {
    const { api } = fakeApi(wishlistHandler());
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    await userEvent.click(within(rowFor("Wizard Arrow")).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByText("Wizard Arrow")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Rush")).toBeInTheDocument();
  });

  it("sends DELETE for the id of the clicked item only", async () => {
    const { api, requests } = fakeApi(wishlistHandler());
    renderApp(api, "/wishlist");
    await screen.findByText("Rush");

    await userEvent.click(within(rowFor("Rush")).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByText("Rush")).not.toBeInTheDocument();
    });
    expect(requests.filter((r) => r.method === "DELETE").map((r) => r.path)).toEqual(["/api/wishlist/2"]);
    expect(screen.getByText("Wizard Arrow")).toBeInTheDocument();
  });

  it("shows an alert and keeps the page and the items when the API answers 500", async () => {
    const { api } = fakeApi(wishlistHandler(true));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    await userEvent.click(within(rowFor("Wizard Arrow")).getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wishlist" })).toBeInTheDocument();
    expect(screen.getByText("Wizard Arrow")).toBeInTheDocument();
    expect(screen.getByText("Rush")).toBeInTheDocument();
  });
});
