import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkStorePluginContract } from "../../src/contract/check-contract.ts";
import { runStorePluginContract } from "../../src/contract/run-contract.ts";
import type { ContractFixtures } from "../../src/contract/fixtures.ts";
import type { PluginContext } from "../../src/context.ts";
import { StoreErrorKind } from "../../src/errors.ts";
import type { StoreError } from "../../src/errors.ts";
import { fetchedListingSchema, searchCandidateSchema, ShippingUnknown } from "../../src/listing.ts";
import type { SearchCandidate } from "../../src/listing.ts";
import { manifestSchema, PluginCapability } from "../../src/manifest.ts";
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
  if (status === HTTP_NOT_FOUND) return err({ kind: StoreErrorKind.NotFound, detail: url });
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
  const page = await ctx.browser.fetchPage(`${base}${query.text}`);
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

const relabelling = (from: StoreErrorKind, to: (detail: string) => StoreError): StorePlugin => withStore((ctx) => ({
  fetchListing: async (url) => {
    const result = await fetchListing(ctx)(url);
    return !result.ok && result.error.kind === from ? err(to(result.error.detail)) : result;
  },
  search: search(ctx),
}));

const unparsed = (): StoreError => ({ kind: StoreErrorKind.ParseFailed, detail: "no listing", rawPage: "x" });

const failedChecks = async (plugin: StorePlugin, kit: ContractFixtures = fixtures): Promise<string[]> =>
  (await checkStorePluginContract(plugin, kit)).map((failure) => failure.check);

const SEARCH_CHECK = "returns schema-valid candidates for the search fixture";

const zodText = <T>(parsed: z.ZodSafeParseResult<T>): string =>
  parsed.success ? "" : z.prettifyError(parsed.error);

runStorePluginContract(goodPlugin, fixtures);

describe("Store plugin contract kit", () => {
  it("passes a plugin that honours the contract", async () => {
    expect(await checkStorePluginContract(goodPlugin, fixtures)).toEqual([]);
  });

  it("fails an invalid manifest", async () => {
    const invalid = { ...manifest, id: "Example Shop" };
    const plugin = withStore((ctx) => goodPlugin.createStore(ctx), invalid);
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "declares a schema-valid manifest",
      message: `invalid manifest:\n${zodText(manifestSchema.safeParse(invalid))}`,
    }]);
  });

  it("fails the manifest check instead of throwing when the manifest is malformed at runtime", async () => {
    const malformed = { ...manifest };
    Reflect.deleteProperty(malformed, "capabilities");
    const plugin = { manifest: malformed, createStore: goodPlugin.createStore.bind(goodPlugin) };
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "declares a schema-valid manifest",
      message: `invalid manifest:\n${zodText(manifestSchema.safeParse(malformed))}`,
    }]);
  });

  it("reports a malformed fixture url as a fixture error and runs no plugin checks", async () => {
    const broken: ContractFixtures = {
      ...fixtures,
      pages: { ...fixtures.pages, "shop.example.com/p/relative": { status: HTTP_OK, body: "" } },
      listings: { ...fixtures.listings, inStock: "not a url" },
    };
    expect(await checkStorePluginContract(goodPlugin, broken)).toEqual([{
      check: "uses well-formed contract fixtures",
      message: "fixture error: not an absolute http(s) url: pages key \"shop.example.com/p/relative\", "
        + "listings.inStock \"not a url\"",
    }]);
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
    const listing = {
      title: "Example frame",
      itemPrice: { amountMinor: 0, currency: "USD" },
      shipping: ShippingUnknown,
      inStock: true,
      images: [],
    };
    const parsed = fetchedListingSchema.safeParse(listing);
    expect(failures[0]?.message).toBe(`returned an invalid listing:\n${zodText(parsed)}`);
  });

  it("fails a plugin that reads stock the wrong way round", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        return result.ok ? ok({ ...result.value, inStock: !result.value.inStock }) : result;
      },
    }), { capabilities: [PluginCapability.FetchListing] });
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([
      {
        check: "parses the in-stock fixture into a schema-valid listing that is in stock",
        message: "expected inStock true, got false",
      },
      { check: "reports inStock false for the out-of-stock fixture", message: "expected inStock false, got true" },
    ]);
  });

  it("fails a plugin that ignores the 404 status", async () => {
    const plugin = relabelling(StoreErrorKind.NotFound, unparsed);
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns not_found for the 404 fixture",
      message: "expected a not_found error, got parse_failed: no listing",
    }]);
  });

  it("fails a plugin that does not recognise the captcha page", async () => {
    const plugin = relabelling(StoreErrorKind.Blocked, unparsed);
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns blocked for the captcha fixture",
      message: "expected a blocked error, got parse_failed: no listing",
    }]);
  });

  it("fails a plugin that hides a host timeout", async () => {
    const emptyPage = { kind: StoreErrorKind.ParseFailed, detail: "empty page" };
    const plugin = relabelling(StoreErrorKind.Timeout, () => emptyPage);
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns timeout when the host http client and browser time out",
      message: "expected a timeout error, got parse_failed: empty page",
    }]);
  });

  it("names the host timeout to a plugin that passes its detail on under another kind", async () => {
    const plugin = relabelling(StoreErrorKind.Timeout, (detail) => ({ kind: StoreErrorKind.Network, detail }));
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns timeout when the host http client and browser time out",
      message: "expected a timeout error, got network: the contract kit timed out the request",
    }]);
  });

  it.each([
    ["does not carry the raw page", {}],
    ["carries an empty raw page", { rawPage: "" }],
  ])("fails a parse failure that %s, and says so", async (_case, raw: { rawPage?: string }) => {
    const plugin = withStore((ctx) => ({
      fetchListing: async (url) => {
        const result = await fetchListing(ctx)(url);
        const parseFailed = !result.ok && result.error.kind === StoreErrorKind.ParseFailed;
        return parseFailed ? err({ kind: StoreErrorKind.ParseFailed, detail: "no listing", ...raw }) : result;
      },
      search: search(ctx),
    }));
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: "returns parse_failed with the raw page for the garbage fixture",
      message: "parse_failed carried no rawPage",
    }]);
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
      fetchListing: (url) => fetchListing(ctx)(`${url}?ref=elsewhere`),
      search: search(ctx),
    }));
    const failures = await checkStorePluginContract(plugin, fixtures);
    expect(failures).toHaveLength(Object.keys(fixtures.listings).length);
    expect(failures[0]?.message).toBe(
      "expected a listing, got network: no fixture page for https://shop.example.com/p/in-stock?ref=elsewhere",
    );
  });

  it("answers a malformed request url with a network error instead of throwing", async () => {
    const plugin = withStore((ctx) => ({ fetchListing: () => fetchListing(ctx)("not a url") }), {
      capabilities: [PluginCapability.FetchListing],
    });
    const failures = await checkStorePluginContract(plugin, fixtures);
    expect(failures[0]?.message).toBe("expected a listing, got network: no fixture page for not a url");
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
    expect(await checkStorePluginContract(goodPlugin, fixturesWithoutSearch)).toEqual([{
      check: SEARCH_CHECK,
      message: "the manifest declares search but the fixtures have no searchQuery",
    }]);
  });

  it("fails a search that returns an error", async () => {
    const plugin = withStore((ctx) => ({ fetchListing: fetchListing(ctx), search: search(ctx, "https://other.example.com/?q=") }));
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: SEARCH_CHECK,
      message: "expected candidates, got network: no fixture page for https://other.example.com/?q=frame",
    }]);
  });

  it.each<[string, SearchCandidate[]]>([
    ["invalid candidates", [{ url: "/relative", title: "Example frame" }]],
    ["no candidates", []],
  ])("fails a search that returns %s", async (_name, candidates) => {
    const plugin = withStore((ctx) => ({
      fetchListing: fetchListing(ctx),
      search: () => Promise.resolve(ok(candidates)),
    }));
    const parsed = z.array(searchCandidateSchema).nonempty().safeParse(candidates);
    expect(await checkStorePluginContract(plugin, fixtures)).toEqual([{
      check: SEARCH_CHECK,
      message: `returned invalid candidates:\n${zodText(parsed)}`,
    }]);
  });

  it("skips the search check when the manifest does not declare search", async () => {
    const plugin = withStore((ctx) => ({
      fetchListing: fetchListing(ctx),
      search: () => Promise.resolve(ok([])),
    }), { capabilities: [PluginCapability.FetchListing] });
    expect(await failedChecks(plugin)).toEqual([]);
  });
});
