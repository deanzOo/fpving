import { apiRoutes } from "@fpving/app/api-routes";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Theme } from "../../src/ui/theme.ts";
import { fakeApi, reply, unreadAlert, wire } from "../support/fake-api.ts";
import { renderApp } from "../support/render-app.tsx";
import { hasBrackets, rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const UNREAD = "?unread=true";
const UNREAD_COUNT = 3;

const scripted = (unread = 0) => {
  const api = fakeApi();
  api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
  const alerts = Array.from({ length: unread }, (_, at) => unreadAlert(`a${String(at)}`, "p1"));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, alerts), UNREAD);
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []));
  return api;
};

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("Nav bar", () => {
  it("shows the wordmark in the mono face and marks the current screen with muted brackets", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByText("fpving", { exact: true })).toBeVisible();
    expect(styleOf(screen.getByText("fpving", { exact: true })).fontFamily).toContain("Martian Mono");
    const current = screen.getByRole("link", { name: "Watchlist" });
    await expect.element(current).toHaveAttribute("aria-current", "page");
    expect(hasBrackets(current)).toBe(true);
    expect(styleOf(current, "::after").backgroundImage).toContain(rgb(token("--color-line-strong")));
    expect(hasBrackets(screen.getByRole("link", { name: "Matches" }))).toBe(false);
  });

  it("draws keyboard focus brackets in the signal colour, on the current item too", async () => {
    const screen = await renderApp(scripted().client);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await userEvent.tab();
    await userEvent.tab();
    const current = screen.getByRole("link", { name: "Watchlist" });
    await expect.element(current).toHaveFocus();
    expect(styleOf(current, "::after").backgroundImage).toContain(rgb(token("--color-signal")));
  });

  it("puts the unread count in the alerts link's name and shows it to sight only", async () => {
    const screen = await renderApp(scripted(UNREAD_COUNT).client);
    const alerts = screen.getByRole("link", { name: "Alerts, 3 unread" });
    await expect.element(alerts).toBeVisible();
    await expect.element(alerts.getByText("3")).toHaveAttribute("aria-hidden", "true");
  });

  it("carries the theme switch", async () => {
    const screen = await renderApp(scripted().client);
    await screen.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Dark);
  });
});
