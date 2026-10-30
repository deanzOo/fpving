import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginIdSchema } from "@fpving/core";
import { describeStoreGatewayContract } from "@fpving/core/testing";
import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginStatusKind } from "../../src/plugins/status.ts";
import { CAPABLE_SHOP, FIXTURE_SHOP, startFixtureGateway } from "../support/fixture-gateway.ts";
import type { FixtureGateway } from "../support/fixture-gateway.ts";
import { FIXTURE_BROKEN_HTML, FixturePath } from "../support/local-server.ts";
import { fixturePlugin } from "../support/plugin-workers.ts";

const CRASHING_SHOP = pluginIdSchema.parse("crashing-shop");
const CRASHING_URL = "https://crashing.example/p/1";

const crashTwice = async (fixture: FixtureGateway): Promise<void> => {
  const disabled = new Promise<void>((resolve) => {
    fixture.host.subscribe((plugins) => {
      if (plugins.some(({ manifest, status }) =>
        manifest?.id === CRASHING_SHOP && status.kind === PluginStatusKind.Disabled)) {
        resolve();
      }
    });
  });
  await fixture.gateway.fetchListing(CRASHING_SHOP, CRASHING_URL);
  await fixture.gateway.fetchListing(CRASHING_SHOP, CRASHING_URL);
  await disabled;
};

describeStoreGatewayContract(async () => {
  const started = await startFixtureGateway([fixturePlugin("crashes")]);
  await crashTwice(started);
  return {
    gateway: started.gateway,
    listingUrl: `${started.server.origin}${FixturePath.Product}`,
    searchablePlugin: FIXTURE_SHOP,
    fetchOnlyPlugin: CAPABLE_SHOP,
    disabledPlugin: CRASHING_SHOP,
    close: async () => started.close(),
  };
});

describe("The store gateway over a real plugin worker and the local server", () => {
  let fixture: FixtureGateway;
  const url = (path: string): string => `${fixture.server.origin}${path}`;

  beforeAll(async () => {
    fixture = await startFixtureGateway();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("loads the plugins listed in plugins.json and routes the local server's hostname to the fixture plugin", () => {
    expect(fixture.host.plugins().map(({ status }) => status.kind)).toEqual([
      PluginStatusKind.Loaded,
      PluginStatusKind.Loaded,
    ]);
    expect(fixture.gateway.pluginFor(url(FixturePath.Product))).toBe(FIXTURE_SHOP);
  });

  it("fetches a listing through the worker's http capability from the local server", async () => {
    expect(await fixture.gateway.fetchListing(FIXTURE_SHOP, url(FixturePath.Product))).toEqual(ok({
      title: "Fixture Frame",
      itemPrice: { amountMinor: 1999, currency: "USD" },
      shipping: { kind: "unknown" },
      inStock: true,
      images: [],
    }));
    expect(fixture.server.requests).toContain(FixturePath.Product);
  });

  it("searches the local server through the worker and returns absolute candidate urls", async () => {
    expect(await fixture.gateway.search(FIXTURE_SHOP, { text: "frame" })).toEqual(ok([
      { url: url(FixturePath.Product), title: "Fixture Frame" },
      { url: url(FixturePath.Broken), title: "Fixture Frame v2" },
    ]));
  });

  it("returns parse_failed for a page the plugin cannot read and saves that page in the debug folder", async () => {
    const result = await fixture.gateway.fetchListing(FIXTURE_SHOP, url(FixturePath.Broken));
    const rawPage = FIXTURE_BROKEN_HTML;
    expect(result).toEqual(err({ kind: StoreErrorKind.ParseFailed, detail: "no title or price", rawPage }));
    const folder = join(fixture.dataDir, "debug", FIXTURE_SHOP);
    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    expect(await readFile(join(folder, files[0] ?? ""), "utf8")).toBe(FIXTURE_BROKEN_HTML);
    expect(fixture.warn).not.toHaveBeenCalled();
  });
});
