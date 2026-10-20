import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type Handler } from "./helpers";

// Forme réelle de GET /api/wishlist : la pièce est imbriquée sous `part`.
// Éléments du seed : pièce, note, priorité.
interface WishlistRow {
  id: number;
  partId: number;
  note: string;
  priority: number;
  part: { id: number; kind: "blade" | "ratchet" | "bit"; name: string };
}

const seedRows: WishlistRow[] = [
  {
    id: 1,
    partId: 5,
    note: "Pour une build défensive",
    priority: 1,
    part: { id: 5, kind: "blade", name: "Wizard Arrow" },
  },
  {
    id: 2,
    partId: 6,
    note: "À tester en attaque",
    priority: 4,
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

// Le formulaire d'ajout charge aussi GET /api/parts : ce chemin répond toujours OK,
// pour que seule la requête de la liste échoue dans les tests d'erreur.
function withParts(wishlist: Handler): Handler {
  const parts = partsHandler();
  return (req) => (req.path === "/api/parts" ? parts(req) : wishlist(req));
}

describe("Wishlist", () => {
  it("lists the two seed items with their part name and note, after a loading state", async () => {
    const { api } = fakeApi(withParts(wishlistHandler()));
    renderApp(api, "/wishlist");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    expect(await screen.findByText("Wizard Arrow")).toBeInTheDocument();
    expect(screen.getByText("Pour une build défensive")).toBeInTheDocument();
    expect(screen.getByText("Rush")).toBeInTheDocument();
    expect(screen.getByText("À tester en attaque")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("requests the wishlist from the API exactly once", async () => {
    const { api, requests } = fakeApi(withParts(wishlistHandler()));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");
    const wishlistRequests = requests.filter((r) => r.path === "/api/wishlist");
    expect(wishlistRequests).toHaveLength(1);
    expect(wishlistRequests[0]).toMatchObject({ method: "GET", path: "/api/wishlist" });
  });

  it("shows Nothing on the wishlist when the list is empty", async () => {
    const { api } = fakeApi(withParts(wishlistHandler([])));
    renderApp(api, "/wishlist");
    expect(await screen.findByText("Nothing on the wishlist")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a generic error with the status on 500", async () => {
    const { api } = fakeApi(withParts(() => new Response("boom", { status: 500 })));
    renderApp(api, "/wishlist");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
  });

  it("shows an unreachable-server error when the request rejects", async () => {
    const { api } = fakeApi(withParts(() => Promise.reject(new Error("offline"))));
    renderApp(api, "/wishlist");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
