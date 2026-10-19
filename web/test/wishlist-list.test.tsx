import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, type Handler } from "./helpers";

// Forme réelle de GET /api/wishlist : la pièce est imbriquée sous `part`.
// Éléments du seed : pièce, note.
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

// Imite GET /api/wishlist : la liste donnée, ou une erreur si le handler le demande.
function wishlistHandler(rows: WishlistRow[] = seedRows): Handler {
  return ({ path }) => {
    if (path !== "/api/wishlist") return new Response("not found", { status: 404 });
    return Response.json(rows);
  };
}

describe("Wishlist", () => {
  it("lists the two seed items with their part name and note, after a loading state", async () => {
    const { api } = fakeApi(wishlistHandler());
    renderApp(api, "/wishlist");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    expect(await screen.findByText("Wizard Arrow")).toBeInTheDocument();
    expect(screen.getByText("Pour une build défensive")).toBeInTheDocument();
    expect(screen.getByText("Rush")).toBeInTheDocument();
    expect(screen.getByText("À tester en attaque")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("requests the wishlist from the API", async () => {
    const { api, requests } = fakeApi(wishlistHandler());
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/wishlist" });
  });

  it("shows Nothing on the wishlist when the list is empty", async () => {
    const { api } = fakeApi(wishlistHandler([]));
    renderApp(api, "/wishlist");
    expect(await screen.findByText("Nothing on the wishlist")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a generic error with the status on 500", async () => {
    const { api } = fakeApi(() => new Response("boom", { status: 500 }));
    renderApp(api, "/wishlist");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
  });

  it("shows an unreachable-server error when the request rejects", async () => {
    const { api } = fakeApi(() => Promise.reject(new Error("offline")));
    renderApp(api, "/wishlist");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
