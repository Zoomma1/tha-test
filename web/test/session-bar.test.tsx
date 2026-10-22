import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp, type Handler } from "./helpers";

// Réponse de GET /api/auth/me pour un utilisateur connecté (forme renvoyée par l'API).
function meOk(): Response {
  return Response.json({ id: 1, handle: "moi", displayName: "Moi" }, { status: 200 });
}

function meUnauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

// Imite la session côté serveur. `me` répond à GET /api/auth/me tant que personne ne s'est déconnecté ;
// après POST /api/auth/logout, /me répond 401. Le reste (la page d'accueil) reçoit la liste des pièces.
function sessionHandler(me: () => Response | Promise<Response>): Handler {
  let loggedOut = false;
  return (req) => {
    if (req.method === "POST" && req.path === "/api/auth/logout") {
      loggedOut = true;
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET" && req.path === "/api/auth/me") {
      return loggedOut ? meUnauthorized() : me();
    }
    return partsHandler()(req);
  };
}

// Liens de la navigation existante, qui doivent rester présents quel que soit l'état de session.
const navLinks = [
  ["Parts", "/"],
  ["Inventory", "/inventory"],
  ["Builds", "/builds"],
  ["Wishlist", "/wishlist"],
] as const;

describe("SessionBar", () => {
  it("shows the display name and a Log out button when /api/auth/me answers 200", async () => {
    const { api, requests } = fakeApi(sessionHandler(meOk));
    renderApp(api, "/");
    expect(await screen.findByText(/Signed in as Moi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register" })).not.toBeInTheDocument();
    expect(requests).toContainEqual(expect.objectContaining({ method: "GET", path: "/api/auth/me" }));
  });

  it("sends POST /api/auth/logout on click, then shows the Log in and Register links", async () => {
    const { api, requests } = fakeApi(sessionHandler(meOk));
    renderApp(api, "/");
    await screen.findByText(/Signed in as Moi/);

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST").map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/auth/logout",
    ]);
  });

  it.each([
    ["a 401", meUnauthorized],
    ["a 404", () => new Response("not found", { status: 404 })],
    ["a network error", () => Promise.reject(new Error("offline"))],
  ])("shows Log in and Register, with no error message, on %s", async (_, me) => {
    const { api } = fakeApi(sessionHandler(me));
    renderApp(api, "/");

    const logIn = await screen.findByRole("link", { name: "Log in" });
    expect(logIn).toHaveAttribute("href", "/login");
    const register = screen.getByRole("link", { name: "Register" });
    expect(register).toHaveAttribute("href", "/register");
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["signed in", meOk],
    ["signed out", meUnauthorized],
  ])("keeps the existing nav links when %s", async (_, me) => {
    const { api } = fakeApi(sessionHandler(me));
    renderApp(api, "/");
    await screen.findByText(/Signed in as Moi|Log in/);

    for (const [name, href] of navLinks) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("renders the session controls outside any list", async () => {
    const { api } = fakeApi(sessionHandler(meOk));
    renderApp(api, "/");
    const logOut = await screen.findByRole("button", { name: "Log out" });
    expect(logOut.closest("ul, li")).toBeNull();
    expect(screen.getByText(/Signed in as Moi/).closest("ul, li")).toBeNull();
  });

  it("renders the logged-out links outside any list", async () => {
    const { api } = fakeApi(sessionHandler(meUnauthorized));
    renderApp(api, "/");
    const logIn = await screen.findByRole("link", { name: "Log in" });
    expect(logIn.closest("ul, li")).toBeNull();
    expect(screen.getByRole("link", { name: "Register" }).closest("ul, li")).toBeNull();
  });
});
