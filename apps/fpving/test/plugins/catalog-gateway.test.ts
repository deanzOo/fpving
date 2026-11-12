import { err, ok, pluginIdSchema } from "@fpving/core";
import { CatalogErrorKind, GearKind } from "@fpving/plugin-sdk";
import type { CatalogEntry } from "@fpving/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createPluginCatalogGateway } from "../../src/plugins/catalog-gateway.ts";
import type { CatalogHost } from "../../src/plugins/catalog-gateway.ts";

const CATALOG = pluginIdSchema.parse("gear-catalog");
const ENTRY: CatalogEntry = { key: "pocket", name: "Pocket", specs: { kind: GearKind.Tool } };
const FAILED = err({ kind: CatalogErrorKind.Failed, detail: "boom" });

const hostWith = (overrides: Partial<CatalogHost> = {}): CatalogHost => ({
  catalogPlugins: () => [CATALOG],
  searchCatalog: vi.fn(async () => Promise.resolve(ok([ENTRY]))),
  getCatalogEntry: vi.fn(async () => Promise.resolve(ok(ENTRY))),
  ...overrides,
});

describe("Catalog gateway", () => {
  it("lists the catalog plugins the host has loaded", () => {
    expect(createPluginCatalogGateway(() => hostWith()).plugins()).toEqual([CATALOG]);
  });

  it("searches a catalog through the host", async () => {
    const host = hostWith();
    const found = await createPluginCatalogGateway(() => host).search(CATALOG, "pocket");
    expect(found).toEqual(ok([ENTRY]));
    expect(host.searchCatalog).toHaveBeenCalledWith(CATALOG, "pocket");
  });

  it("gets a catalog entry through the host", async () => {
    const host = hostWith();
    const found = await createPluginCatalogGateway(() => host).get(CATALOG, "pocket");
    expect(found).toEqual(ok(ENTRY));
    expect(host.getCatalogEntry).toHaveBeenCalledWith(CATALOG, "pocket");
  });

  it("passes a catalog failure on unchanged", async () => {
    const host = hostWith({ searchCatalog: async () => Promise.resolve(FAILED) });
    expect(await createPluginCatalogGateway(() => host).search(CATALOG, "x")).toEqual(FAILED);
  });

  it("follows the host the app runs now", () => {
    let current = hostWith({ catalogPlugins: () => [] });
    const gateway = createPluginCatalogGateway(() => current);
    expect(gateway.plugins()).toEqual([]);
    current = hostWith();
    expect(gateway.plugins()).toEqual([CATALOG]);
  });
});
