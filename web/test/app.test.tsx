import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp } from "./helpers";

describe("App routes", () => {
  it.each([
    ["Inventory", "Inventory"],
    ["Builds", "Builds"],
    ["Wishlist", "Wishlist"],
    ["Parts", "Pièces"],
  ])("the %s link shows its page", async (link, title) => {
    const { api } = fakeApi(partsHandler());
    renderApp(api, link === "Parts" ? "/inventory" : "/");
    await userEvent.click(screen.getByRole("link", { name: link }));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("passes the id of /parts/:id to the detail page", () => {
    const { api } = fakeApi(partsHandler());
    renderApp(api, "/parts/42");
    const heading = screen.getByRole("heading", { level: 1, name: "Part detail" });
    expect(heading).toHaveAttribute("data-part-id", "42");
  });

  it("shows a not-found message on an unknown path", () => {
    const { api } = fakeApi(partsHandler());
    renderApp(api, "/nope");
    expect(screen.getByText("Page introuvable.")).toBeInTheDocument();
  });
});
