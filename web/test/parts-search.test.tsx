import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, parts, renderApp, type Handler, type RecordedRequest } from "./helpers";

// Imite GET /api/parts (filtres kind et search) et GET /api/parts/:id, comme l'API réelle.
function catalogueHandler(): Handler {
  return ({ path, search }) => {
    const detail = /^\/api\/parts\/(\d+)$/.exec(path);
    if (detail !== null) {
      const part = parts.find((p) => String(p.id) === detail[1]);
      if (part === undefined) return Response.json({ error: "part not found" }, { status: 404 });
      return Response.json(part);
    }
    if (path !== "/api/parts") return new Response("not found", { status: 404 });
    const params = new URLSearchParams(search);
    const kind = params.get("kind");
    const text = params.get("search") ?? "";
    return Response.json(parts.filter((p) => (kind === null || p.kind === kind) && p.name.includes(text)));
  };
}

function lastParam(requests: RecordedRequest[], name: string): string | null {
  return new URLSearchParams(requests.at(-1)?.search).get(name);
}

describe("Parts search", () => {
  it("re-queries the API with the typed text as search", async () => {
    const { api, requests } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    await userEvent.type(screen.getByLabelText("Search"), "Dran");
    await waitFor(() => {
      expect(lastParam(requests, "search")).toBe("Dran");
    });
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Dran Sword" })).toBeInTheDocument();
  });

  it("combines the type filter and the search text", async () => {
    const { api, requests } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "blade");
    await userEvent.type(screen.getByLabelText("Search"), "Dran");
    await waitFor(() => {
      expect(lastParam(requests, "kind")).toBe("blade");
      expect(lastParam(requests, "search")).toBe("Dran");
    });
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(screen.getByRole("link", { name: "Dran Sword" })).toBeInTheDocument();
  });

  it("keeps the type filter when the search matches only another type", async () => {
    const { api } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "ratchet");
    await userEvent.type(screen.getByLabelText("Search"), "Dran");
    expect(await screen.findByText("No part found")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows every part again when the search text is cleared", async () => {
    const { api } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    const input = screen.getByLabelText("Search");
    await userEvent.type(input, "Dran");
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    await userEvent.clear(input);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
    });
    expect(screen.queryByText("No part found")).not.toBeInTheDocument();
  });

  it("shows each part name as a link to its detail page", async () => {
    const { api } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    expect(await screen.findByRole("link", { name: "Dran Sword" })).toHaveAttribute("href", "/parts/1");
    expect(screen.getByRole("link", { name: "Hells Scythe" })).toHaveAttribute("href", "/parts/2");
    expect(screen.getByRole("link", { name: "3-60" })).toHaveAttribute("href", "/parts/3");
    expect(screen.getByRole("link", { name: "Flat" })).toHaveAttribute("href", "/parts/4");
  });

  it("opens the detail of a part when its name is clicked", async () => {
    const { api, requests } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await userEvent.click(await screen.findByRole("link", { name: "Hells Scythe" }));
    expect(await screen.findByRole("heading", { name: "Hells Scythe" })).toBeInTheDocument();
    expect(requests.at(-1)).toMatchObject({ method: "GET", path: "/api/parts/2" });
  });

  it("shows No part found when the search matches nothing", async () => {
    const { api } = fakeApi(catalogueHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    await userEvent.type(screen.getByLabelText("Search"), "Zzz");
    await waitFor(() => {
      expect(screen.getByText("No part found")).toBeInTheDocument();
    });
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows No part found when the API returns no part at all", async () => {
    const { api } = fakeApi(() => Response.json([]));
    renderApp(api, "/");
    expect(await screen.findByText("No part found")).toBeInTheDocument();
  });
});
