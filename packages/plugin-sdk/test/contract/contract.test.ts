import { describe, expect, it } from "vitest";
import { checkStorePluginContract } from "../../src/contract/check-contract.ts";
import { runStorePluginContract } from "../../src/contract/run-contract.ts";
import type { ContractFixtures } from "../../src/contract/fixtures.ts";
import type { PluginContext } from "../../src/context.ts";
import { StoreErrorKind } from "../../src/errors.ts";
import { ShippingUnknown } from "../../src/listing.ts";
import type { SearchCandidate } from "../../src/listing.ts";
import { PluginCapability } from "../../src/manifest.ts";
import type { PluginManifest } from "../../src/manifest.ts";
import type { Store, StorePlugin } from "../../src/plugin.ts";
import { err, ok } from "../../src/result.ts";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const LISTING = /^listing\|(?<title>[^|]+)\|(?<price>\d+)\|(?<stock>in|out)$/;
const SEARCH_BASE = "https://shop.example.com/search?q=";

const manifest: PluginManifest = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["shop.example.com"],
  capabilities: [PluginCapability.FetchListing, PluginCapability.Search],
};

const fixturesWithoutSearch: ContractFixtures = {
  shipTo: "IL",
  currencyPreference: "USD",
  pages: {
    "https://SHOP.example.com/p/in-stock": { status: HTTP_OK, body: "listing|Example frame|4599|in" },
    "https://shop.example.com/p/out-of-stock": { status: HTTP_OK, body: "listing|Example motor|1999|out" },
    "https://shop.example.com/p/gone": { status: HTTP_NOT_FOUND, body: "Page not found" },
    "https://shop.example.com/p/captcha": { status: HTTP_OK, body: "Please solve this captcha" },
    "https://shop.example.com/p/garbage": { status: HTTP_OK, body: "<html>redesigned</html>" },
    [`${SEARCH_BASE}frame`]: { status: HTTP_OK, body: "https://shop.example.com/p/in-stock|Example frame" },
  },
  listings: {
    inStock: "https://shop.example.com/p/in-stock",
    outOfStock: "https://shop.example.com/p/out-of-stock",
    notFound: "https://shop.example.com/p/gone",
    captcha: "https://shop.example.com/p/captcha",
    garbage: "https://shop.example.com/p/garbage",
  },
};

const fixtures: ContractFixtures = { ...fixturesWithoutSearch, searchQuery: { text: "frame" } };

const fetchListing = (ctx: PluginContext): Store["fetchListing"] => async (url) => {
  const response = await ctx.http.get(url);
  if (!response.ok) return err(response.error);
  const { status, body } = response.value;
  ctx.logger.debug("fetched", { status, at: ctx.clock.now().toISOString() });
  if (status === HTTP_NOT_FOUND) return err({ kind: StoreErrorKind.NotFound, detail: url.href });
  if (body.includes("captcha")) return err({ kind: StoreErrorKind.Blocked, detail: "captcha" });
  const groups = LISTING.exec(body)?.groups;
  if (groups === undefined) return err({ kind: StoreErrorKind.ParseFailed, detail: "no listing", rawPage: body });
  return ok({
    title: String(groups["title"]),
    itemPrice: { amountMinor: Number(groups["price"]), currency: ctx.currencyPreference },
    shipping: ShippingUnknown,
    inStock: groups["stock"] === "in",
    images: [],
  });
};

const search = (ctx: PluginContext, base = SEARCH_BASE): NonNullable<Store["search"]> => async (query) => {
  const page = await ctx.browser.fetchPage(new URL(`${base}${query.text}`));
  if (!page.ok) return err(page.error);
  return ok(page.value.html.split("\n").map((line) => {
    const [url = "", title = ""] = line.split("|");
    return { url, title };
  }));
};

const goodPlugin: StorePlugin = {
  manifest,
  createStore: (ctx) => ({ fetchListing: fetchListing(ctx), search: search(ctx) }),
};

const withStore = (store: (ctx: PluginContext) => Store, override: Partial<PluginManifest> = {}): StorePlugin => ({
  manifest: { ...manifest, ...override },
  createStore: store,
});

const failedChecks = async (plugin: StorePlugin, kit: ContractFixtures = fixtures): Promise<string[]> =>
  (await checkStorePluginContract(plugin, kit)).map((failure) => failure.check);

const SEARCH_CHECK = "returns schema-valid candidates for the search fixture";

runStorePluginContract(goodPlugin, fixtures);

describe("store plugin contract kit", () => {
  it("passes a plugin that honours the contract", async () => {
    expect(await checkStorePluginContract(goodPlugin, fixtures)).toEqual([]);
  });

  it("fails an invalid manifest", async () => {
    const plugin = withStore((ctx) => goodPlugin.createStore(ctx), { id: "Example Shop" });
    expect(await failedChecks(plugin)).toEqual(["declares a schema-valid manifest"]);
  });

  it("fails a listing of the wrong shape and explains why", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        return result.ok ? ok({ ...result.value, itemPrice: { amountMinor: 0, currency: "USD" } }) : result;
      },
      search: search(ctx),
    }));
    const failures = await checkStorePluginContract(plugin, fixtures);
    expect(failures.map((failure) => failure.check)).toEqual([
      "parses the in-stock fixture into a schema-valid listing that is in stock",
      "reports inStock false for the out-of-stock fixture",
    ]);
    expect(failures[0]?.message).toContain("itemPrice.amountMinor");
  });

  it("fails a plugin that reads stock the wrong way round", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        return result.ok ? ok({ ...result.value, inStock: !result.value.inStock }) : result;
      },
    }), { capabilities: [PluginCapability.FetchListing] });
    expect(await failedChecks(plugin)).toEqual([
      "parses the in-stock fixture into a schema-valid listing that is in stock",
      "reports inStock false for the out-of-stock fixture",
    ]);
  });

  it("fails a plugin that ignores the 404 status", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        const notFound = !result.ok && result.error.kind === StoreErrorKind.NotFound;
        return notFound ? err({ kind: StoreErrorKind.ParseFailed, detail: "no listing", rawPage: "x" }) : result;
      },
      search: search(ctx),
    }));
    expect(await failedChecks(plugin)).toEqual(["returns not_found for the 404 fixture"]);
  });

  it("fails a plugin that hides a host timeout", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        const timedOut = !result.ok && result.error.kind === StoreErrorKind.Timeout;
        return timedOut ? err({ kind: StoreErrorKind.ParseFailed, detail: "empty page" }) : result;
      },
      search: search(ctx),
    }));
    expect(await failedChecks(plugin)).toEqual(["returns timeout when the host http client and browser time out"]);
  });

  it("fails a parse failure that does not carry the raw page", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        const parseFailed = !result.ok && result.error.kind === StoreErrorKind.ParseFailed;
        return parseFailed ? err({ kind: StoreErrorKind.ParseFailed, detail: "no listing" }) : result;
      },
      search: search(ctx),
    }));
    expect(await failedChecks(plugin)).toEqual(["returns parse_failed with the raw page for the garbage fixture"]);
  });

  it("fails a plugin that invents a listing for a page it cannot parse", async () => {
    const placeholder = { amountMinor: 1, currency: "USD" } as const;
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        const parseFailed = !result.ok && result.error.kind === StoreErrorKind.ParseFailed;
        const invented = { title: "Unknown", itemPrice: placeholder, shipping: ShippingUnknown, inStock: true };
        return parseFailed ? ok({ ...invented, images: [] }) : result;
      },
      search: search(ctx),
    }));
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns parse_failed with the raw page for the garbage fixture",
      message: "expected a parse_failed error, got a successful result",
    }]);
  });

  it("fails every fetch check for a plugin that requests pages the fixtures do not have", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: (url) => fetchListing(ctx)(new URL(`${url.href}?ref=elsewhere`)),
      search: search(ctx),
    }));
    const failures = await checkStorePluginContract(plugin, fixtures);
    expect(failures).toHaveLength(Object.keys(fixtures.listings).length);
    expect(failures[0]?.message).toContain("no fixture page for https://shop.example.com/p/in-stock?ref=elsewhere");
  });

  it("fails a plugin that throws instead of returning a store result", async () => {
    const plugin = withStore(() => ({
      fetchListing: () => Promise.reject(new Error("selector missing")),
    }), { capabilities: [PluginCapability.FetchListing] });
    const failures = await checkStorePluginContract(plugin, fixtures);
    expect(failures).toHaveLength(Object.keys(fixtures.listings).length + 1);
    expect(failures[0]?.message).toBe("threw instead of returning a store result: Error: selector missing");
  });

  it("fails a plugin that declares search without implementing it", async () => {
    const plugin = withStore((ctx) => ({ fetchListing: fetchListing(ctx) }));
    const failures = await checkStorePluginContract(plugin, fixtures);
    const message = "the manifest declares search but the store has no search method";
    expect(failures).toEqual([{ check: SEARCH_CHECK, message }]);
  });

  it("fails a search plugin when the fixtures have no search query", async () => {
    expect(await failedChecks(goodPlugin, fixturesWithoutSearch)).toEqual([SEARCH_CHECK]);
  });

  it("fails a search that returns an error", async () => {
    const plugin = withStore((ctx) => ({ fetchListing: fetchListing(ctx), search: search(ctx, "https://other.example.com/?q=") }));
    expect(await failedChecks(plugin)).toEqual([SEARCH_CHECK]);
  });

  it.each<[string, SearchCandidate[]]>([
    ["invalid candidates", [{ url: "/relative", title: "Example frame" }]],
    ["no candidates", []],
  ])("fails a search that returns %s", async (_name, candidates) => {
    const plugin = withStore((ctx) => ({
      fetchListing: fetchListing(ctx),
      search: () => Promise.resolve(ok(candidates)),
    }));
    expect(await failedChecks(plugin)).toEqual([SEARCH_CHECK]);
  });

  it("skips the search check when the manifest does not declare search", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: fetchListing(ctx),
      search: () => Promise.resolve(ok([])),
    }), { capabilities: [PluginCapability.FetchListing] });
    expect(await failedChecks(plugin)).toEqual([]);
  });
});
