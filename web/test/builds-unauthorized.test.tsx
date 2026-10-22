import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp } from "./helpers";

const loginMessage = "Please log in to see your builds.";

// Réponse d'authentification manquante, telle que l'API la renvoie : `{ error }` avec le statut 401.
function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

// Un build vide, sans pièce : le composeur s'affiche sous ce build.
const emptyBuild = { id: 1, name: "Shark Night", parts: [] };

// Le message doit être dans l'alerte de la page, avec un lien « Log in » vers /login.
// La nav a elle aussi un lien « Log in » : on le cherche donc dans l'alerte uniquement.
function expectLoginPrompt(alert: HTMLElement) {
  expect(alert).toHaveTextContent(loginMessage);
  const link = within(alert).getByRole("link", { name: "Log in" });
  expect(link).toHaveAttribute("href", "/login");
}

describe("Builds without a session", () => {
  it("shows the login message and a Log in link on 401 at load, and no build", async () => {
    const { api } = fakeApi((req) => (req.path === "/api/builds" ? unauthorized() : partsHandler()(req)));
    renderApp(api, "/builds");

    expectLoginPrompt(await screen.findByRole("alert"));
    expect(screen.queryByText("Dran Sword 3-60 Flat")).not.toBeInTheDocument();
    expect(screen.queryByText("No build yet")).not.toBeInTheDocument();
  });

  it("leads to the login page from the Log in link of the message", async () => {
    const { api } = fakeApi((req) => (req.path === "/api/builds" ? unauthorized() : partsHandler()(req)));
    renderApp(api, "/builds");

    const link = within(await screen.findByRole("alert")).getByRole("link", { name: "Log in" });
    await userEvent.click(link);

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
  });

  it("shows the login message on 401 when a build is created", async () => {
    const { api } = fakeApi((req) => {
      if (req.method === "POST" && req.path === "/api/builds") return unauthorized();
      if (req.path === "/api/builds") return Response.json([]);
      return partsHandler()(req);
    });
    renderApp(api, "/builds");
    await screen.findByText("No build yet");

    await userEvent.type(screen.getByRole("textbox", { name: /name/i }), "Shark Night");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expectLoginPrompt(await screen.findByRole("alert"));
    expect(screen.queryByRole("heading", { name: "Shark Night" })).not.toBeInTheDocument();
  });

  it("shows the login message on 401 when a part is added to a build", async () => {
    const { api } = fakeApi((req) => {
      if (req.method === "POST" && req.path === "/api/builds/1/parts") return unauthorized();
      if (req.path === "/api/builds") return Response.json([emptyBuild]);
      if (req.path === "/api/builds/1/missing") return Response.json([]);
      return partsHandler()(req);
    });
    renderApp(api, "/builds");
    await screen.findByRole("heading", { name: "Shark Night" });
    await screen.findByRole("option", { name: "Hells Scythe" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /part/i }), "Hells Scythe");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expectLoginPrompt(await screen.findByRole("alert"));
  });

  it("keeps the status error on 500 at load, without the login message", async () => {
    const { api } = fakeApi((req) =>
      req.path === "/api/builds" ? new Response("boom", { status: 500 }) : partsHandler()(req),
    );
    renderApp(api, "/builds");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Request failed with status 500");
    expect(screen.queryByText(loginMessage)).not.toBeInTheDocument();
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
  });
});
