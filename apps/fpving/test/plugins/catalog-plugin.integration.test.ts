import { pluginIdSchema } from "@fpving/core";
import { ok } from "@fpving/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginStatusKind } from "../../src/plugins/status.ts";
import { CAPABLE_SHOP, FIXTURE_SHOP, startFixtureGateway } from "../support/fixture-gateway.ts";
import type { FixtureGateway } from "../support/fixture-gateway.ts";
import { fixturePlugin } from "../support/plugin-workers.ts";

const CATALOG = pluginIdSchema.parse("fixture-catalog");
const LAVA = {
  key: "lava-ii-480",
  name: "LAVA II 480",
  specs: { kind: "battery", cells: 1, chemistry: "lihv", capacityMah: 480, connector: "bt2" },
};

describe("Catalog plugins", () => {
  let fixture: FixtureGateway;

  beforeAll(async () => {
    fixture = await startFixtureGateway([fixturePlugin("catalog")]);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("loads a catalog plugin beside store plugins without claiming domains", () => {
    expect(fixture.host.plugins().map(({ manifest, status }) => [manifest?.id, status.kind])).toEqual([
      [FIXTURE_SHOP, PluginStatusKind.Loaded],
      [CAPABLE_SHOP, PluginStatusKind.Loaded],
      [CATALOG, PluginStatusKind.Loaded],
    ]);
    expect(fixture.host.catalogPlugins()).toEqual([CATALOG]);
    expect(fixture.host.registry.declaredDomains()).not.toContain(CATALOG);
    expect(fixture.gateway.isLoaded(CATALOG)).toBe(false);
    expect(fixture.gateway.searchablePlugins()).toEqual([FIXTURE_SHOP]);
  });

  it("searches a catalog plugin by text", async () => {
    expect(await fixture.host.searchCatalog(CATALOG, "lava")).toEqual(ok([LAVA]));
    expect(await fixture.host.getCatalogEntry(CATALOG, LAVA.key)).toEqual(ok(LAVA));
    expect(await fixture.host.getCatalogEntry(CATALOG, "no-such-key")).toEqual(ok(null));
  });

  it("drops a catalog entry whose specs break the vocabulary and keeps the rest", async () => {
    const found = await fixture.host.searchCatalog(CATALOG, "a");
    expect(found.ok ? found.value.map(({ key }) => key) : found).toEqual([
      "radiomaster-boxer-crush",
      "eachine-ev800d",
      LAVA.key,
    ]);
    expect(fixture.warn).toHaveBeenCalledWith("dropped an invalid catalog entry", expect.objectContaining({
      pluginId: CATALOG,
    }));
  });

  it("gives a catalog plugin no http or browser in its context", () => {
    expect(fixture.host.plugins().find(({ manifest }) => manifest?.id === CATALOG)?.status).toEqual({
      kind: PluginStatusKind.Loaded,
      warnings: [],
    });
  });
});
