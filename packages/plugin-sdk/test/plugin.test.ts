import { describe, expect, expectTypeOf, it } from "vitest";
import type { PluginContext } from "../src/context.ts";
import { StoreErrorKind } from "../src/errors.ts";
import { ShippingUnknown } from "../src/listing.ts";
import { PluginCapability } from "../src/manifest.ts";
import type { Store, StorePlugin } from "../src/plugin.ts";
import { err, ok } from "../src/result.ts";

const PRICE = 1000;
const HTTP_OK = 200;

const plugin: StorePlugin = {
  manifest: {
    id: "example",
    displayName: "Example",
    version: "1.0.0",
    sdkVersion: ">=0.0.0 <1.0.0",
    domains: ["example.com"],
    capabilities: [PluginCapability.FetchListing],
  },
  createStore: (ctx) => ({
    fetchListing: async (url) => {
      const response = await ctx.http.get(url);
      if (!response.ok) return err(response.error);
      ctx.logger.info("fetched", { status: response.value.status });
      return ok({
        title: response.value.body,
        itemPrice: { amountMinor: PRICE, currency: ctx.currencyPreference },
        shipping: ShippingUnknown,
        inStock: true,
        images: [],
      });
    },
  }),
};

const context = (http: PluginContext["http"]): PluginContext => ({
  http,
  browser: { fetchPage: () => Promise.resolve(err({ kind: StoreErrorKind.Network, detail: "unused" })) },
  logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  clock: { now: () => new Date(0) },
  shipTo: "IL",
  currencyPreference: "ILS",
});

describe("Store plugin", () => {
  it("builds a store from the host context and reads pages through the host http client", async () => {
    const page = { status: HTTP_OK, body: "Frame", headers: {} };
    const store = plugin.createStore(context({ get: () => Promise.resolve(ok(page)) }));
    const result = await store.fetchListing("https://example.com/p/1");
    const itemPrice = { amountMinor: PRICE, currency: "ILS" };
    expect(result).toEqual(ok(expect.objectContaining({ title: "Frame", itemPrice })));
  });

  it("passes a host transport error straight through as a store error", async () => {
    const timeout = { kind: StoreErrorKind.Timeout, detail: "30s elapsed" };
    const store = plugin.createStore(context({ get: () => Promise.resolve(err(timeout)) }));
    expect(await store.fetchListing("https://example.com/p/1")).toEqual(err(timeout));
  });

  it("makes search optional on a store", () => {
    expectTypeOf<Store["search"]>().toEqualTypeOf<Store["search"] | undefined>();
  });
});
