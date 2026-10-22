import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type Handler } from "./helpers";

// Message affiché à la place de l'inventaire quand l'API répond 401 (lien « Log in » vers /login).
const invitation = "Please log in to see your inventory.";

// Forme réelle de GET /api/owned-parts : la pièce est imbriquée sous `part`.
const seedRows = [
  { id: 1, partId: 1, quantity: 1, part: { id: 1, kind: "blade", name: "Dran Sword" } },
  { id: 2, partId: 2, quantity: 1, part: { id: 2, kind: "blade", name: "Hells Scythe" } },
  { id: 3, partId: 3, quantity: 2, part: { id: 3, kind: "ratchet", name: "3-60" } },
  { id: 4, partId: 4, quantity: 1, part: { id: 4, kind: "bit", name: "Flat" } },
];

// Erreur d'API au format `{ "error": "<message court>" }`.
function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface Responses {
  list?: () => Response;
  write?: () => Response;
}

// Imite un serveur sans session. GET /api/owned-parts répond `list`, les écritures (POST, PATCH, DELETE)
// répondent `write` (401 par défaut). GET /api/auth/me répond 401 : la barre de session affiche donc
// son propre lien « Log in », que les tests ignorent en se limitant à la page Inventory.
function serverHandler({ list = () => Response.json(seedRows), write = () => apiError("unauthorized", 401) }: Responses = {}): Handler {
  return (req) => {
    if (req.path === "/api/parts") return partsHandler()(req);
    if (req.path === "/api/auth/me") return apiError("unauthorized", 401);
    if (req.path === "/api/owned-parts" && req.method === "GET") return list();
    if (req.path.startsWith("/api/owned-parts")) return write();
    return new Response("not found", { status: 404 });
  };
}

// La section Inventory, hors de la barre de navigation.
function inventoryPage(): HTMLElement {
  const section = screen.getByRole("heading", { name: "Inventory" }).closest("section");
  if (section === null) throw new Error("Inventory section not found");
  return section;
}

// Le message d'invitation est affiché dans la page, avec un lien « Log in » vers /login.
async function expectInvitation() {
  const page = inventoryPage();
  expect(await within(page).findByText(invitation)).toBeInTheDocument();
  expect(within(page).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
}

describe("Inventory when the API answers 401", () => {
  it("shows the invitation and a Log in link to /login instead of any row, on load", async () => {
    const { api } = fakeApi(serverHandler({ list: () => apiError("unauthorized", 401) }));
    renderApp(api, "/inventory");

    await expectInvitation();
    expect(screen.queryByRole("row", { name: /Dran Sword/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same invitation when adding a part is refused with 401", async () => {
    const { api } = fakeApi(serverHandler());
    renderApp(api, "/inventory");
    await screen.findByRole("row", { name: /Dran Sword/ });
    await screen.findByRole("option", { name: "Flat" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /part/i }), "Flat");
    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    await expectInvitation();
  });

  it("shows the same invitation when saving a quantity is refused with 401", async () => {
    const { api } = fakeApi(serverHandler());
    renderApp(api, "/inventory");

    await userEvent.click(await screen.findByRole("button", { name: "Save Dran Sword" }));

    await expectInvitation();
  });

  it("shows the same invitation when deleting a row is refused with 401", async () => {
    const { api } = fakeApi(serverHandler());
    renderApp(api, "/inventory");

    await userEvent.click(await screen.findByRole("button", { name: "Delete Dran Sword" }));

    await expectInvitation();
  });
});

describe("Inventory when the API answers 500", () => {
  it("keeps the generic load error and shows no invitation", async () => {
    const { api } = fakeApi(serverHandler({ list: () => new Response("boom", { status: 500 }) }));
    renderApp(api, "/inventory");

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
    expect(screen.queryByText(invitation)).not.toBeInTheDocument();
    expect(within(inventoryPage()).queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("keeps the API error message on a failed delete and shows no invitation", async () => {
    const { api } = fakeApi(serverHandler({ write: () => apiError("internal error", 500) }));
    renderApp(api, "/inventory");

    await userEvent.click(await screen.findByRole("button", { name: "Delete Dran Sword" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("internal error");
    expect(screen.queryByText(invitation)).not.toBeInTheDocument();
    expect(within(inventoryPage()).queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });
});
