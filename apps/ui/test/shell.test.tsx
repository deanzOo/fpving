import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { DEFAULT_SETTINGS, settingsSchema } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ErrorView } from "../src/error-view.tsx";
import { ApiFailure, ClientErrorKind } from "../src/client.ts";
import { takeLogged } from "./support/console-guard.ts";
import { at, failWith, fakeApi, product, reply, unreadAlert, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

const UNREAD = "?unread=true";

const scripted = () => {
  const api = fakeApi();
  api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), UNREAD);
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []));
  api.on(apiRoutes.listPlugins, reply(wire.plugins, []));
  const shown = { product: product("p1", "Product"), listings: [] };
  api.on(at(apiRoutes.getProduct, { productId: "p1" }), reply(wire.detail, shown));
  api.on(apiRoutes.getSettings, reply(wire.settings, settingsSchema.parse(DEFAULT_SETTINGS)));
  return api;
};

describe("App shell", () => {
  it("shows a navigation landmark with a link to every screen", async () => {
    const screen = await renderApp(scripted().client);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const name of ["Watchlist", "Matches", "Alerts", "Settings", "Plugins"]) {
      await expect.element(nav.getByRole("link", { name, exact: false })).toBeVisible();
    }
    await expect.element(screen.getByRole("main")).toBeVisible();
  });

  it.each([
    ["/", "Watchlist"],
    ["/products/p1", "Product"],
    ["/matches", "Matches"],
    ["/alerts", "Alerts"],
    ["/settings", "Settings"],
    ["/plugins", "Plugins"],
  ])("renders the screen of %s", async (path, heading) => {
    const screen = await renderApp(scripted().client, path);
    await expect.element(screen.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });

  it("follows a navigation link to its screen", async () => {
    const screen = await renderApp(scripted().client);
    await screen.getByRole("link", { name: "Settings" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  });

  it("moves focus to the new screen after a navigation", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByRole("main")).not.toHaveFocus();
    await screen.getByRole("link", { name: "Plugins" }).click();
    await expect.element(screen.getByRole("main")).toHaveFocus();
  });

  it("shows a not found screen for a path no route serves", async () => {
    const screen = await renderApp(scripted().client, "/nowhere");
    await expect.element(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  it("shows the unread alert count on the alerts link", async () => {
    const api = scripted();
    api.on(apiRoutes.listAlerts, reply(wire.alerts, [unreadAlert("a1", "p1"), unreadAlert("a2", "p1")]), UNREAD);
    const screen = await renderApp(api.client);
    await expect.element(screen.getByRole("link", { name: "Alerts, 2 unread" })).toBeVisible();
  });

  it("shows no count on the alerts link when nothing is unread", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByRole("link", { name: "Alerts", exact: true })).toBeVisible();
  });

  it("lets the keyboard reach the skip link first and then the navigation", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await userEvent.tab();
    await expect.element(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await userEvent.tab();
    await expect.element(screen.getByRole("link", { name: "Watchlist" })).toHaveFocus();
  });

  it("renders the error kind when a screen fails to load, and loads it again on retry", async () => {
    const api = scripted();
    const starting = failWith(HttpStatus.ServiceUnavailable, ApiErrorKind.Starting, "fpving is starting");
    api.on(apiRoutes.listProducts, starting);
    const screen = await renderApp(api.client);
    const alert = screen.getByRole("main").getByRole("alert");
    await expect.element(alert.getByText("fpving is starting")).toBeVisible();
    await expect.element(alert.getByText(ApiErrorKind.Starting, { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(screen.getByText("Nothing is watched yet", { exact: false })).toBeVisible();
    const logged = takeLogged().flat();
    expect(logged).toContainEqual(expect.objectContaining({ kind: ApiErrorKind.Starting }));
    expect(logged).toContain("Warning: Error in route match: //");
  });
});

describe("Error view", () => {
  it("explains a failure the way the screens do", async () => {
    const restarting = new ApiFailure(ApiErrorKind.Restarting, "restarting");
    const screen = await render(<ErrorView error={restarting} reset={() => undefined} />);
    await expect.element(screen.getByText("fpving is restarting its plugins", { exact: false })).toBeVisible();
  });

  it("names an error that did not come from the API unexpected", async () => {
    const screen = await render(<ErrorView error={new Error("boom")} reset={() => undefined} />);
    await expect.element(screen.getByText(ClientErrorKind.Unexpected, { exact: true })).toBeVisible();
  });
});
