import { apiRoutes } from "@fpving/app/api-routes";
import { PluginCapability } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { fakeApi, reply, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

type Row = z.output<typeof wire.plugins>[number];

const HOUR_MS = 3_600_000;
const TWO = 2;
const STALE = 3;
const { Disabled, Loaded } = wire.plugins.element.shape.status.enum;
const issueKind = wire.plugins.element.shape.issues.element.shape.kind.enum;
const { ConfigInvalid, DomainConflict, EntryInvalid, SdkIncompatible } = issueKind;

const manifest = (id: string, displayName: string) => ({
  id, displayName, version: "1.0.0", sdkVersion: ">=0.0.0 <1.0.0", domains: [`${id}.example`, `www.${id}.example`],
  capabilities: [PluginCapability.FetchListing],
});

const plugin = (overrides: Partial<Row>): Row => ({
  source: "./plugins/shop", manifest: manifest("shop", "Shop"), status: Loaded, issues: [], backoffUntil: null,
  staleListings: 0, ...overrides,
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
    await expect.element(screen.getByRole("row", { name: /^Mall mall/u }).getByText("Backing off, retrying in 2 hours"))
      .toBeVisible();
  });

  it("shows a loaded plugin's warnings", async () => {
    const warned = plugin({ issues: [{ kind: DomainConflict, detail: "shop.example is also declared by mall" }] });
    const screen = await renderApp(scripted([warned]).client, "/plugins");
    const row = screen.getByRole("row", { name: /^Shop shop/u });
    await expect.element(row.getByText("Loaded", { exact: true })).toBeVisible();
    await expect.element(row.getByText("Warning (domain_conflict): shop.example is also declared by mall"))
      .toBeVisible();
  });

  it("shows a disabled plugin with the reason", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^Old old/u })
      .getByText("Disabled (sdk_incompatible): needs sdk >=2.0.0")).toBeVisible();
  });

  it("shows a rejected plugins.json entry as its own row", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^plugins\.json\[2\]/u })
      .getByText("Disabled (entry_invalid): path must be a string")).toBeVisible();
  });

  it("shows an unusable plugins.json as a row of its own", async () => {
    const screen = await renderApp(scripted(rows()).client, "/plugins");
    await expect.element(screen.getByRole("row", { name: /^plugins\.json\b(?!\[)/u })
      .getByText("plugins.json is unusable: not JSON")).toBeVisible();
  });

  it("says when no plugin is listed", async () => {
    const screen = await renderApp(scripted([]).client, "/plugins");
    await expect.element(screen.getByText("No plugin is listed in plugins.json.", { exact: false })).toBeVisible();
  });
});
