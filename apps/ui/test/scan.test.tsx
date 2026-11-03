import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import type { PlainErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { pluginIdSchema, ScanOutcome, scanRunIdSchema } from "@fpving/core";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { emptyTrend, failWith, fakeApi, product, reply, wire, Role } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

type Status = z.output<typeof wire.scan>;

const MINUTE_MS = 60_000;
const FIVE = 5;
const SUCCEEDED = 3;
const FAILED = 1;
const ALERTS = 2;
const SCAN_DONE_MS = 4000;

const idle: Status = { running: false, latestRun: null, lastResult: null };

const finished = (minutesAgo: number): Status => {
  const finishedAt = new Date(Date.now() - minutesAgo * MINUTE_MS);
  const run = {
    id: scanRunIdSchema.parse("r1"), pluginId: pluginIdSchema.parse("shop"), startedAt: finishedAt, finishedAt,
    outcome: ScanOutcome.Ok, errorKind: null,
  };
  return {
    running: false,
    latestRun: run,
    lastResult: {
      finishedAt, plugins: [{ run, succeeded: SUCCEEDED, failed: FAILED }], alerts: ALERTS, transitions: 0,
    },
  };
};

const scripted = (status: Status) => {
  const api = fakeApi();
  api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.getScan, reply(wire.scan, status));
  return api;
};

describe("Scan now", () => {
  it("shows when the last scan finished and what it did", async () => {
    const screen = await renderApp(scripted(finished(FIVE)).client);
    await expect.element(screen.getByRole("status").getByText(
      "Last scan finished 5 minutes ago: 3 listings fetched, 1 failed, 2 alerts",
    )).toBeVisible();
  });

  it("reads the watchlist once on first load, not again for a scan that finished before", async () => {
    const api = scripted(finished(FIVE));
    api.on(apiRoutes.startScan, failWith(HttpStatus.Conflict, ApiErrorKind.ScanRunning, "refused"));
    const screen = await renderApp(api.client);
    await expect.element(screen.getByText(/^Last scan finished/u)).toBeVisible();
    await screen.getByRole("button", { name: "Scan now" }).click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    expect(api.sent.filter(({ path }) => path === apiRoutes.listProducts.url)).toHaveLength(1);
  });

  it("says no scan has finished yet", async () => {
    const screen = await renderApp(scripted(idle).client);
    await expect.element(screen.getByText("No scan has finished since fpving started.")).toBeVisible();
  });

  it("starts a scan, shows it running, then shows its result and the refreshed watchlist", async () => {
    const api = scripted(idle);
    const running = { ...idle, running: true };
    api.on(apiRoutes.startScan, () => {
      api.on(apiRoutes.getScan, () => {
        api.on(apiRoutes.getScan, reply(wire.scan, finished(0)));
        const row = { product: product("p1", "Acme X5 frame"), cheapest: null, trend: emptyTrend(), unreadAlerts: 0 };
        api.on(apiRoutes.listProducts, reply(wire.watchlist, [row]));
        return reply(wire.scan, running)();
      });
      return reply(wire.scan, running, HttpStatus.Accepted)();
    });
    const screen = await renderApp(api.client);
    await screen.getByRole("button", { name: "Scan now" }).click();
    await expect.element(screen.getByText("Scanning every listing…")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Scan now" })).toHaveAttribute("aria-disabled", "true");
    await expect.element(screen.getByText(/^Last scan finished .+: 3 listings fetched/u), { timeout: SCAN_DONE_MS })
      .toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Acme X5 frame" })).toBeVisible();
  });

  it("reads the scan status again when a scan it did not start is running", async () => {
    const api = scripted(finished(FIVE));
    api.on(apiRoutes.startScan, () => {
      api.on(apiRoutes.getScan, reply(wire.scan, { ...finished(FIVE), running: true }));
      return failWith(HttpStatus.Conflict, ApiErrorKind.ScanRunning, "a scan is already running")();
    });
    const screen = await renderApp(api.client);
    await expect.element(screen.getByText(/^Last scan finished/u)).toBeVisible();
    await screen.getByRole("button", { name: "Scan now" }).click();
    await expect.element(screen.getByText("Scanning every listing…")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Scan now" })).toHaveAttribute("aria-disabled", "true");
  });

  it.each([
    [HttpStatus.Conflict, ApiErrorKind.ScanRunning, Role.Alert, "Refused A scan is already running."],
    [HttpStatus.ServiceUnavailable, ApiErrorKind.Restarting, Role.Status,
      "Restarting fpving is restarting its plugins for a settings change. Try again in a moment."],
    [HttpStatus.ServiceUnavailable, ApiErrorKind.ShuttingDown, Role.Alert, "Refused fpving is shutting down."],
  ] satisfies [number, PlainErrorKind, Role, string][])("explains a %d %s refusal", async (
    status, kind, role, shown,
  ) => {
    const api = scripted(idle);
    api.on(apiRoutes.startScan, failWith(status, kind, "refused"));
    const screen = await renderApp(api.client);
    const button = screen.getByRole("button", { name: "Scan now" });
    await button.click();
    await expect.element(screen.getByRole(role).filter({ hasText: shown })).toHaveTextContent(shown);
    await expect.element(button).toHaveFocus();
  });
});
