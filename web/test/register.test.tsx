import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type FetchImpl } from "../src/lib/api-client";
import { parts, renderApp } from "./helpers";

const moi = { id: 1, handle: "moi", displayName: "Moi" };
const password = "mot-de-passe-test";

// Imite l'API : POST /api/auth/register répond selon `register`, et GET /api/auth/me suit la session
// (401 tant qu'aucune inscription n'a réussi). GET /api/parts sert la page d'accueil après l'inscription.
// Chaque corps reçu par POST /api/auth/register est gardé dans `registrations`, et chaque requête
// (méthode et chemin) dans `sent`, pour vérifier qu'une validation n'envoie rien.
function serverWith(register: () => Response | Promise<Response>) {
  const registrations: unknown[] = [];
  const sent: string[] = [];
  let signedIn = false;

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    sent.push(`${req.method} ${path}`);
    if (req.method === "POST" && path === "/api/auth/register") {
      const body: unknown = JSON.parse(await req.text());
      registrations.push(body);
      const reply = await register();
      if (reply.status === 201) signedIn = true;
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
  return { api: createApi("http://localhost", fetchImpl), registrations, sent };
}

// Envoie un formulaire : le champ « Display name » n'est rempli que s'il est fourni.
async function fill(handle: string, pass: string, displayName = "") {
  if (handle.length > 0) await userEvent.type(screen.getByLabelText("Handle"), handle);
  if (displayName.length > 0) await userEvent.type(screen.getByLabelText("Display name"), displayName);
  if (pass.length > 0) await userEvent.type(screen.getByLabelText("Password"), pass);
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
}

function postsSent(sent: string[]): string[] {
  return sent.filter((line) => line.startsWith("POST "));
}

describe("Register page", () => {
  it("shows the title, the Handle, Display name and Password fields and the Register button", () => {
    const { api } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    expect(screen.getByRole("heading", { level: 1, name: "Register" })).toBeInTheDocument();
    expect(screen.getByLabelText("Handle")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
  });

  it("does not require the Display name field", () => {
    const { api } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    expect(screen.getByLabelText("Display name")).not.toBeRequired();
  });

  it("masks the password while it is typed", async () => {
    const { api } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    const field = screen.getByLabelText("Password");
    await userEvent.type(field, password);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(password);
  });

  it.each([
    ["two characters", "ab"],
    ["twenty-one characters", "a".repeat(21)],
    ["an upper-case letter", "Moi"],
    ["a hyphen", "mo-i"],
    ["a space", "mo i"],
    ["an empty value", ""],
  ])("shows the handle message and sends nothing for a handle with %s", async (_, value) => {
    const { api, sent } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill(value, password);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Handle must be 3 to 20 lowercase letters, digits or underscores");
    expect(postsSent(sent)).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Register" })).toBeInTheDocument();
  });

  it.each([
    ["three characters", "abc"],
    ["twenty characters", "a".repeat(20)],
    ["digits and an underscore", "abc_123"],
  ])("accepts a handle of %s", async (_, value) => {
    const { api, registrations } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill(value, password);

    await screen.findByRole("heading", { level: 1, name: "Pièces" });
    expect(registrations).toEqual([{ handle: value, password }]);
  });

  it.each([
    ["seven characters", "abcdefg"],
    ["seventy-three characters", "a".repeat(73)],
  ])("shows the password message and sends nothing for a password of %s", async (_, value) => {
    const { api, sent } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill("moi", value);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Password must be 8 to 72 characters");
    expect(postsSent(sent)).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Register" })).toBeInTheDocument();
  });

  it.each([
    ["eight characters", "a".repeat(8)],
    ["seventy-two characters", "a".repeat(72)],
  ])("accepts a password of %s", async (_, value) => {
    const { api, registrations } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill("moi", value);

    await screen.findByRole("heading", { level: 1, name: "Pièces" });
    expect(registrations).toEqual([{ handle: "moi", password: value }]);
  });

  it("sends handle, password and displayName to POST /api/auth/register on submit", async () => {
    const { api, registrations } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill("moi", password, "Moi");

    await screen.findByRole("heading", { level: 1, name: "Pièces" });
    expect(registrations).toEqual([{ handle: "moi", password, displayName: "Moi" }]);
  });

  it("omits displayName from the body when the Display name field is empty", async () => {
    const { api, registrations } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill("moi", password);

    await screen.findByRole("heading", { level: 1, name: "Pièces" });
    expect(registrations).toEqual([{ handle: "moi", password }]);
    expect(registrations[0]).not.toHaveProperty("displayName");
  });

  it("leaves /register and shows Signed in as <displayName> after a 201", async () => {
    const { api } = serverWith(() => Response.json(moi, { status: 201 }));
    renderApp(api, "/register");

    await fill("moi", password);

    expect(await screen.findByRole("heading", { level: 1, name: "Pièces" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Register" })).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as Moi/)).toBeInTheDocument();
  });

  it.each([
    ["a 409", () => Response.json({ error: "handle taken" }, { status: 409 }), "Handle already taken"],
    ["a 500", () => Response.json({ error: "boom" }, { status: 500 }), "Registration failed"],
    ["a network error", () => Promise.reject(new Error("offline")), "Registration failed"],
  ])("stays on the page and shows an alert with the right message on %s", async (_, register, message) => {
    const { api } = serverWith(register);
    renderApp(api, "/register");

    await fill("moi", password);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(screen.getByRole("heading", { level: 1, name: "Register" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
  });

  it("disables the Register button while the registration request is pending", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = serverWith(async () => {
      await gate;
      return Response.json(moi, { status: 201 });
    });
    renderApp(api, "/register");

    await fill("moi", password);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
    });

    release();
    await screen.findByRole("heading", { level: 1, name: "Pièces" });
  });
});
