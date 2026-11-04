import { apiRoutes } from "@fpving/app/api-routes";
import { PluginCapability } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { fakeApi, reply, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";
import { expectBadge, rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

type Row = z.output<typeof wire.plugins>[number];

const HOUR_MS = 3_600_000;
const TWO = 2;
const STALE = 3;
const { Disabled, Loaded } = wire.plugins.element.shape.status.enum;
const issueKind = wire.plugins.element.shape.issues.element.shape.kind.enum;
const { ConfigInvalid, DomainConflict, EntryInvalid, NotListed, SdkIncompatible } = issueKind;

const manifest = (id: string, displayName: string) => ({
  id, displayName, version: "1.0.0", sdkVersion: ">=0.0.0 <1.0.0", domains: [`${id}.example`, `www.${id}.example`],
  capabilities: [PluginCapability.FetchListing],
});

const plugin = (overrides: Partial<Row>): Row => ({
  source: "./plugins/shop", manifest: manifest("shop", "Shop"), status: Loaded, issues: [], backoffUntil: null,
  staleListings: 0, unscannedListings: 0, ...overrides,
});

const rows = (): Row[] => [
  plugin({ staleListings: STALE }),
  plugin({
    source: "./plugins/mall", manifest: manifest("mall", "Mall"), backoffUntil: new Date(Date.now() + TWO * HOUR_MS),
  }),
  plugin({
    source: "./plugins/old", manifest: manifest("old", "Old"), status: Disabled,
    issues: [{ kind: SdkIncompatible, detail: "needs sdk >=2.0.0" }],
  }),
  plugin({
    source: "plugins.json[2]", manifest: null, status: Disabled,
    issues: [{ kind: EntryInvalid, detail: "path must be a string" }],
  }),
  plugin({
    source: "plugins.json", manifest: null, status: Disabled, issues: [{ kind: ConfigInvalid, detail: "not JSON" }],
  }),
];

const scripted = (plugins: Row[]) => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.listPlugins, reply(wire.plugins, plugins));
  return api;
};

describe("Plugins", () => {
  it("shows a loaded plugin with its name, id, domains and stale listing count", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    const row = screen.getByRole("row", { name: /^Shop shop/u });
    await expect.element(row.getByRole("cell", { name: "Loaded", exact: true })).toBeVisible();
    await expect.element(row.getByRole("cell", { name: "shop.example, www.shop.example" })).toBeVisible();
    await expect.element(row.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  });

  it("shows a plugin backing off and when it retries", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    const mall = screen.getByRole("row", { name: /^Mall mall/u });
    await expect.element(mall.getByText(/Backing off, retrying in 2 hours/u)).toBeVisible();
  });

  it("shows a loaded plugin's warnings", async () => {
    const warned = plugin({ issues: [{ kind: DomainConflict, detail: "shop.example is also declared by mall" }] });
    const screen = await renderApp(scripted([warned]).client, "/plugins");
    const row = screen.getByRole("row", { name: /^Shop shop/u });
    await expect.element(row.getByText("Loaded", { exact: true })).toBeVisible();
    await expect.element(row.getByText(/Warning: domain_conflict: shop\.example is also declared by mall/u))
      .toBeVisible();
  });

  it("shows a disabled plugin with the reason", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^Old old/u })
      .getByText(/Disabled: sdk_incompatible: needs sdk >=2\.0\.0/u)).toBeVisible();
  });

  it("shows a rejected plugins.json entry as its own row", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^plugins\.json\[2\]/u })
      .getByText(/Disabled: entry_invalid: path must be a string/u)).toBeVisible();
  });

  it("shows an unusable plugins.json as a row of its own", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^plugins\.json\b(?!\[)/u })
      .getByText("plugins.json is unusable: not JSON")).toBeVisible();
  });

  it("shows a loaded plugin as a live status in the signal colour", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    const loaded = screen.getByRole("row", { name: /^Shop shop/u }).getByText("Loaded", { exact: true });
    await expect.element(loaded).toBeVisible();
    expect(styleOf(loaded).color).toBe(rgb(token("--color-signal")));
  });

  it.each([
    [/^Old old/u, "Disabled", "✕", "--color-on-critical"],
    [/^plugins\.json\b(?!\[)/u, "Config invalid", "✕", "--color-on-critical"],
    [/^Mall mall/u, "Backing off", "↻", "--color-warning"],
  ])("shows a troubled plugin's state as a badge: %s", async (name, word, glyph, ink) => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expectBadge(screen.getByRole("row", { name }).getByText(word, { exact: true }), glyph, ink);
  });

  it("shows a loaded plugin's warning as a warning badge with the detail beside it", async () => {
    const warned = plugin({ issues: [{ kind: DomainConflict, detail: "shop.example is also declared by mall" }] });
    const screen = await renderApp(scripted([warned]).client, "/plugins");
    await expectBadge(screen.getByText("Warning", { exact: true }), "▲", "--color-warning");
    expect(styleOf(screen.getByText("domain_conflict", { exact: true })).fontFamily).toContain("Martian Mono");
  });

  it("shows how many of a plugin's listings are not being scanned, in the warning colour", async () => {
    const unlisted = plugin({
      source: "listings of gone-shop", manifest: null, status: Disabled, unscannedListings: STALE,
      issues: [{ kind: NotListed, detail: "no plugin in plugins.json provides this id" }],
    });
    const screen = await renderApp(scripted([unlisted]).client, "/plugins");
    await expect.element(screen.getByRole("rowheader", { name: "listings of gone-shop" })).toBeVisible();
    await expect.element(screen.getByRole("columnheader", { name: "Not scanned" })).toBeVisible();
    await expect.element(screen.getByText("provides this id", { exact: false })).toBeVisible();
    expect(styleOf(screen.getByText(String(STALE))).color).toBe(rgb(token("--color-warning")));
  });

  it("marks stale listings in the warning colour, and none in plain ink", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    const stale = screen.getByRole("row", { name: /^Shop shop/u }).getByText("3", { exact: true });
    await expect.element(stale).toBeVisible();
    expect(styleOf(stale).color).toBe(rgb(token("--color-warning")));
    const none = screen.getByRole("row", { name: /^Mall mall/u }).getByRole("cell", { name: "0", exact: true }).first();
    expect(styleOf(none).color).toBe(rgb(token("--color-ink")));
  });

  it("says when no plugin is listed", async () => {
    const screen = await renderApp(scripted([]).client, "/plugins");
    await expect.element(screen.getByText("No plugin is listed in plugins.json.", { exact: false })).toBeVisible();
  });
});
