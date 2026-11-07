import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { DEFAULT_SETTINGS, settingsSchema } from "@fpving/core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ErrorView } from "../src/error-view.tsx";
import { ApiFailure, ClientErrorKind } from "../src/client.ts";
import { takeLogged } from "./support/console-guard.ts";
import { at, failWith, fakeApi, product, reply, unreadAlert, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";
import { expectEmptyRegionsTakeNoRoom, hasBrackets, rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

const UNREAD = "?unread=true";
const ROW_WIDTH = 900;

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
    for (const name of ["Watchlist", "Matches", "Alerts", "Settings", "Plugins", "Atlas"]) {
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
    const notice = screen.getByRole("main").getByRole("status");
    await expect.element(notice.getByText("fpving is starting")).toBeVisible();
    await expect.element(notice.getByText(ApiErrorKind.Starting, { exact: true })).toBeVisible();
    await expect.element(notice.getByText("Starting", { exact: true })).toBeVisible();
    expect(styleOf(notice.getByText("Starting", { exact: true })).color).toBe(rgb(token("--color-warning")));
    await expect.element(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(screen.getByText("Nothing is watched yet", { exact: false })).toBeVisible();
    const logged = takeLogged().flat();
    expect(logged).toContainEqual(expect.objectContaining({ kind: ApiErrorKind.Starting }));
    expect(logged).toContain("Warning: Error in route match: //");
  });

  it("focuses the error heading on a failure and a failed retry, and main once a retry succeeds", async () => {
    const api = scripted();
    const internal = failWith(HttpStatus.InternalServerError, ApiErrorKind.Internal, "broken");
    api.on(apiRoutes.listProducts, internal);
    const screen = await renderApp(api.client);
    const heading = screen.getByRole("heading", { level: 1, name: "Something went wrong" });
    await expect.element(heading).toHaveFocus();
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(heading).toHaveFocus();
    api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await expect.element(heading).not.toBeInTheDocument();
    await expect.element(screen.getByRole("main")).toHaveFocus();
    takeLogged();
  });

  it("focuses the error heading, not main, when a screen just navigated to fails", async () => {
    const api = scripted();
    api.on(apiRoutes.listPlugins, failWith(HttpStatus.InternalServerError, ApiErrorKind.Internal, "broken"));
    const screen = await renderApp(api.client);
    await screen.getByRole("link", { name: "Plugins" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toHaveFocus();
    takeLogged();
  });

  it.each([
    ["/", "Add product"],
    ["/products/p1", "Add listing"],
    ["/alerts", "Mark all read"],
    ["/settings", "Save settings"],
  ])("leaves no gap for the empty notice regions on %s", async (path, name) => {
    const screen = await renderApp(scripted().client, path);
    await expect.element(screen.getByRole("button", { name })).toBeVisible();
    expectEmptyRegionsTakeNoRoom();
  });

  it("draws no outline on main or a focus heading after a keyboard navigation", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    screen.getByRole("link", { name: "Plugins" }).element().focus();
    await userEvent.keyboard("{Enter}");
    const main = screen.getByRole("main");
    await expect.element(main).toHaveFocus();
    expect(main.element().matches(":focus-visible")).toBe(true);
    expect(styleOf(main).outlineStyle).toBe("none");
  });
});

describe("Error view", () => {
  it("explains a failure the way the screens do", async () => {
    const restarting = new ApiFailure(ApiErrorKind.Restarting, "restarting");
    const screen = await render(<ErrorView error={restarting} reset={() => undefined} />);
    await expect.element(screen.getByText("fpving is restarting its plugins", { exact: false })).toBeVisible();
  });

  it("starts at the content edge, with its notice across the whole row", async () => {
    const failure = new ApiFailure(ApiErrorKind.Internal, "boom");
    const screen = await render(
      <div style={{ width: ROW_WIDTH }}><ErrorView error={failure} reset={() => undefined} /></div>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    await expect.element(heading).toBeVisible();
    const row = screen.container.firstElementChild?.getBoundingClientRect();
    expect(heading.element().getBoundingClientRect().left).toBe(row?.left);
    expect(screen.getByRole("alert").element().getBoundingClientRect().width).toBe(row?.width);
  });

  it.each([ApiErrorKind.Internal, ApiErrorKind.Starting, ApiErrorKind.Restarting])(
    "takes focus to its heading when it appears for a %s failure", async (kind) => {
      const failure = new ApiFailure(kind, "boom");
      const screen = await render(<ErrorView error={failure} reset={() => undefined} />);
      await expect.element(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toHaveFocus();
    },
  );

  it("draws no brackets or outline on its heading, even when a keyboard press brought it there", async () => {
    const Shown = () => {
      const [failed, fail] = useState(false);
      return failed
        ? <ErrorView error={new Error("boom")} reset={() => undefined} />
        : <button type="button" onClick={() => { fail(true); }}>Load</button>;
    };
    const screen = await render(<Shown />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const heading = screen.getByRole("heading", { level: 1 });
    await expect.element(heading).toHaveFocus();
    expect(heading.element().matches(":focus-visible")).toBe(true);
    expect(hasBrackets(heading)).toBe(false);
    expect(styleOf(heading).outlineStyle).toBe("none");
  });

  it("still retries when it is shown outside the app's main element", async () => {
    const reset = vi.fn();
    const screen = await render(<ErrorView error={new Error("boom")} reset={reset} />);
    await screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("names an error that did not come from the API unexpected", async () => {
    const screen = await render(<ErrorView error={new Error("boom")} reset={() => undefined} />);
    await expect.element(screen.getByText(ClientErrorKind.Unexpected, { exact: true })).toBeVisible();
  });
});
