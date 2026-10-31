import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { AlertKind } from "@fpving/core";
import type { Alert } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { at, emptyTrend, failWith, fakeApi, noContent, product, reply, unreadAlert, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

const UNREAD = "?unread=true";
const READ_AT = new Date("2026-10-30T09:00:00.000Z");

const watched = [{ product: product("p1", "Acme X5 frame"), cheapest: null, trend: emptyTrend(), unreadAlerts: 1 }];
const drop = unreadAlert("a2", "p1");
const stocked: Alert = { ...unreadAlert("a1", "p1"), kind: AlertKind.BackInStock, readAt: READ_AT };
const gone: Alert = { ...unreadAlert("a3", "p9"), kind: AlertKind.NewCheapest };

const scripted = (all: Alert[]) => {
  const api = fakeApi();
  api.on(apiRoutes.listProducts, reply(wire.watchlist, watched));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, all));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, all.filter(({ readAt }) => readAt === null)), UNREAD);
  return api;
};

describe("Alerts", () => {
  it("lists every alert in the order the server gives, newest first, with its kind, product and state", async () => {
    const screen = await renderApp(scripted([drop, stocked]).client, "/alerts");
    const items = screen.getByRole("listitem");
    await expect.element(items.nth(0).getByText("Price drop", { exact: true })).toBeVisible();
    await expect.element(items.nth(0).getByText("Acme X5 frame", { exact: true })).toBeVisible();
    await expect.element(items.nth(0).getByText("Unread", { exact: true })).toBeVisible();
    await expect.element(items.nth(1).getByText("Back in stock", { exact: true })).toBeVisible();
    await expect.element(items.nth(1).getByText("Read", { exact: true })).toBeVisible();
    await expect.element(items.nth(0).getByRole("link", { name: "Acme X5 frame" }))
      .toHaveAttribute("href", "/products/p1");
  });

  it("names a product that is no longer watched without linking to it", async () => {
    const screen = await renderApp(scripted([gone]).client, "/alerts");
    await expect.element(screen.getByRole("listitem").getByText("New cheapest listing", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("a product no longer watched")).toBeVisible();
    await expect.element(screen.getByRole("listitem").getByRole("link")).not.toBeInTheDocument();
  });

  it("shows only unread alerts with the unread only filter", async () => {
    const screen = await renderApp(scripted([drop, stocked]).client, "/alerts");
    await expect.element(screen.getByRole("listitem").nth(1)).toBeVisible();
    await screen.getByRole("checkbox", { name: "Unread only" }).click();
    await expect.element(screen.getByRole("listitem").nth(1)).not.toBeInTheDocument();
    await expect.element(screen.getByRole("listitem").getByText("Price drop", { exact: true })).toBeVisible();
  });

  it("marks one alert read and updates the list and the unread count in the navigation", async () => {
    const api = scripted([drop]);
    api.on(at(apiRoutes.markAlertRead, { alertId: "a2" }), () => {
      api.on(apiRoutes.listAlerts, reply(wire.alerts, [{ ...drop, readAt: READ_AT }]));
      api.on(apiRoutes.listAlerts, reply(wire.alerts, []), UNREAD);
      return noContent();
    });
    const screen = await renderApp(api.client, "/alerts");
    await expect.element(screen.getByRole("link", { name: "Alerts, 1 unread" })).toBeVisible();
    await screen.getByRole("button", { name: "Mark read" }).click();
    await expect.element(screen.getByRole("listitem").getByText("Read", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Mark read" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("link", { name: "Alerts", exact: true })).toBeVisible();
  });

  it("marks every alert read and says how many it marked", async () => {
    const api = scripted([drop, gone]);
    api.on(apiRoutes.markAllAlertsRead, () => {
      api.on(apiRoutes.listAlerts, reply(wire.alerts, []), UNREAD);
      return reply(wire.marked, { marked: 2 })();
    });
    const screen = await renderApp(api.client, "/alerts");
    await screen.getByRole("button", { name: "Mark all read" }).click();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Marked 2 alerts read.");
    await expect.element(screen.getByRole("link", { name: "Alerts", exact: true })).toBeVisible();
  });

  it("explains a failed mark read", async () => {
    const api = scripted([drop]);
    api.on(
      at(apiRoutes.markAlertRead, { alertId: "a2" }),
      failWith(HttpStatus.NotFound, ApiErrorKind.AlertNotFound, "no alert has this id"),
    );
    const screen = await renderApp(api.client, "/alerts");
    await screen.getByRole("button", { name: "Mark read" }).click();
    await expect.element(screen.getByRole("alert").getByText("no alert has this id", { exact: true })).toBeVisible();
  });

  it("says when there is no alert at all", async () => {
    const screen = await renderApp(scripted([]).client, "/alerts");
    await expect.element(screen.getByText("No alerts yet.")).toBeVisible();
  });

  it("says when no alert is unread under the unread only filter", async () => {
    const screen = await renderApp(scripted([stocked]).client, "/alerts");
    await screen.getByRole("checkbox", { name: "Unread only" }).click();
    await expect.element(screen.getByText("No unread alerts.")).toBeVisible();
  });
});
