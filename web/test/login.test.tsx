import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type FetchImpl } from "../src/lib/api-client";
import { parts, renderApp } from "./helpers";

interface LoginBody {
  handle: string;
  password: string;
}

function isLoginBody(value: unknown): value is LoginBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "handle" in value &&
    "password" in value &&
    typeof value.handle === "string" &&
    typeof value.password === "string"
  );
}

const moi = { id: 1, handle: "moi", displayName: "Moi" };
const password = "mot-de-passe-test";

// Imite l'API : POST /api/auth/login répond selon `login`, et GET /api/auth/me suit la session
// (401 tant qu'aucune connexion n'a réussi). GET /api/parts sert la page d'accueil après la connexion.
// Chaque corps reçu par POST /api/auth/login est gardé dans `logins`.
function serverWith(login: (body: LoginBody) => Response | Promise<Response>) {
  const logins: unknown[] = [];
  let signedIn = false;

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/api/auth/login") {
      const body: unknown = JSON.parse(await req.text());
      logins.push(body);
      if (!isLoginBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      const reply = await login(body);
      if (reply.status === 200) signedIn = true;
      return reply;
    }
    if (req.method === "GET" && path === "/api/auth/me") {
      return signedIn
        ? Response.json(moi, { status: 200 })
        : Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (req.method === "GET" && path === "/api/parts") return Response.json(parts);
    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), logins };
}

// Remplit les deux champs puis clique sur le bouton « Log in » du formulaire.
async function submit(handle: string, pass: string) {
  await userEvent.type(screen.getByLabelText("Handle"), handle);
  await userEvent.type(screen.getByLabelText("Password"), pass);
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("Login page", () => {
  it("shows the title, the Handle and Password fields and the Log in button", () => {
    const { api } = serverWith(() => Response.json(moi, { status: 200 }));
    renderApp(api, "/login");

    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Handle")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("masks the password while it is typed", async () => {
    const { api } = serverWith(() => Response.json(moi, { status: 200 }));
    renderApp(api, "/login");

    const field = screen.getByLabelText("Password");
    await userEvent.type(field, password);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(password);
  });

  it("sends handle and password to POST /api/auth/login on submit", async () => {
    const { api, logins } = serverWith(() => Response.json(moi, { status: 200 }));
    renderApp(api, "/login");

    await submit("moi", password);

    await screen.findByRole("heading", { level: 1, name: "Pièces" });
    expect(logins).toEqual([{ handle: "moi", password }]);
  });

  it("leaves /login and shows Signed in as <displayName> after a 200", async () => {
    const { api } = serverWith(() => Response.json(moi, { status: 200 }));
    renderApp(api, "/login");

    await submit("moi", password);

    expect(await screen.findByRole("heading", { level: 1, name: "Pièces" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Log in" })).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as Moi/)).toBeInTheDocument();
  });

  it.each([
    ["a 401", () => Response.json({ error: "invalid credentials" }, { status: 401 }), "Invalid handle or password"],
    ["a 429", () => Response.json({ error: "too many attempts" }, { status: 429 }), "Too many attempts, try again later"],
    ["a 500", () => Response.json({ error: "boom" }, { status: 500 }), "Login failed"],
    ["a network error", () => Promise.reject(new Error("offline")), "Login failed"],
  ])("stays on the page and shows an alert with the right message on %s", async (_, login, message) => {
    const { api } = serverWith(login);
    renderApp(api, "/login");

    await submit("moi", password);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("disables the Log in button while the login request is pending", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = serverWith(async () => {
      await gate;
      return Response.json(moi, { status: 200 });
    });
    renderApp(api, "/login");

    await submit("moi", password);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
    });

    release();
    await screen.findByRole("heading", { level: 1, name: "Pièces" });
  });
});
