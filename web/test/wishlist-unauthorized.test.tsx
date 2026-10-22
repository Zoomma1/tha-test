import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type Handler } from "./helpers";

// Message affiché à la place de la wishlist quand l'API répond 401 (lien « Log in » vers /login).
const invitation = "Please log in to see your wishlist.";

// Forme réelle de GET /api/wishlist : la pièce est imbriquée sous `part`.
// Éléments du seed : Wizard Arrow (id 1) et Rush (id 2).
const seedRows = [
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

// Erreur d'API au format `{ "error": "<message court>" }`.
function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface Responses {
  list?: () => Response;
  add?: () => Response;
  remove?: () => Response;
}

// Imite un serveur sans session. GET /api/wishlist répond `list`, POST /api/wishlist répond `add`,
// DELETE /api/wishlist/:id répond `remove`. Par défaut tout réussit.
// GET /api/auth/me répond 401 : la barre de session affiche donc son propre lien « Log in »,
// que les tests ignorent en se limitant à la section Wishlist.
function serverHandler({
  list = () => Response.json(seedRows),
  add = () => new Response(null, { status: 201 }),
  remove = () => new Response(null, { status: 204 }),
}: Responses = {}): Handler {
  const parts = partsHandler();
  return (req) => {
    if (req.path === "/api/parts") return parts(req);
    if (req.path === "/api/auth/me") return apiError("unauthorized", 401);
    if (req.path === "/api/wishlist" && req.method === "GET") return list();
    if (req.path === "/api/wishlist" && req.method === "POST") return add();
    if (/^\/api\/wishlist\/\d+$/.test(req.path) && req.method === "DELETE") return remove();
    return new Response("not found", { status: 404 });
  };
}

// La section Wishlist, hors de la barre de navigation.
function wishlistPage(): HTMLElement {
  const section = screen.getByRole("heading", { name: "Wishlist" }).closest("section");
  if (section === null) throw new Error("Wishlist section not found");
  return section;
}

// La ligne de liste qui affiche le nom donné.
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no list item shows ${name}`);
  return row;
}

// Le message d'invitation est affiché dans la page, avec un lien « Log in » vers /login.
async function expectInvitation() {
  const page = wishlistPage();
  expect(await within(page).findByText(invitation)).toBeInTheDocument();
  expect(within(page).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
}

describe("Wishlist when the API answers 401", () => {
  it("shows the invitation and a Log in link to /login instead of any item, on load", async () => {
    const { api } = fakeApi(serverHandler({ list: () => apiError("unauthorized", 401) }));
    renderApp(api, "/wishlist");

    await expectInvitation();
    expect(screen.queryByText("Wizard Arrow")).not.toBeInTheDocument();
    expect(screen.queryByText("Rush")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing on the wishlist")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same invitation when adding a part is refused with 401", async () => {
    const { api } = fakeApi(serverHandler({ add: () => apiError("unauthorized", 401) }));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");
    await screen.findByRole("option", { name: "Flat" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Part" }), "Flat");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await expectInvitation();
  });

  it("shows the same invitation when removing an item is refused with 401", async () => {
    const { api } = fakeApi(serverHandler({ remove: () => apiError("unauthorized", 401) }));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    await userEvent.click(within(rowFor("Wizard Arrow")).getByRole("button", { name: "Remove" }));

    await expectInvitation();
  });
});

describe("Wishlist when the API answers 500", () => {
  it("keeps the generic load error and shows no invitation", async () => {
    const { api } = fakeApi(serverHandler({ list: () => new Response("boom", { status: 500 }) }));
    renderApp(api, "/wishlist");

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
    expect(screen.queryByText(invitation)).not.toBeInTheDocument();
    expect(within(wishlistPage()).queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("keeps the error on a failed add and shows no invitation", async () => {
    const { api } = fakeApi(serverHandler({ add: () => new Response("boom", { status: 500 }) }));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");
    await screen.findByRole("option", { name: "Flat" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Part" }), "Flat");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
    expect(screen.queryByText(invitation)).not.toBeInTheDocument();
    expect(within(wishlistPage()).queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("keeps the error on a failed remove and shows no invitation", async () => {
    const { api } = fakeApi(serverHandler({ remove: () => new Response("boom", { status: 500 }) }));
    renderApp(api, "/wishlist");
    await screen.findByText("Wizard Arrow");

    await userEvent.click(within(rowFor("Wizard Arrow")).getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
    expect(screen.queryByText(invitation)).not.toBeInTheDocument();
    expect(within(wishlistPage()).queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });
});
