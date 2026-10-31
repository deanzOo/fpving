import {
  AlertKind,
  alertSchema,
  err,
  ListingOrigin,
  listingSchema,
  ListingStatus,
  ok,
  priceSnapshotSchema,
  productIdSchema,
  productSchema,
} from "@fpving/core";
import type { Alert } from "@fpving/core";
import { StoreErrorKind } from "@fpving/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GatewayRefusal } from "../../src/plugins/store-gateway.ts";
import { NOT_ATTACHED, registerApiRoutes } from "../../src/server/api.ts";
import { apiRoutes } from "../../src/server/api-routes.ts";
import { ApiErrorKind, apiErrorSchema } from "../../src/server/errors.ts";
import { createServer, HttpStatus } from "../../src/server/server.ts";
import {
  API_HOST,
  API_PORT,
  LISTING,
  networkError,
  OTHER,
  OTHER_DOMAIN,
  SHOP,
  SHOP_DOMAIN,
  startApiHarness,
} from "../support/api-harness.ts";
import type { ApiHarness } from "../support/api-harness.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const PAGE = `https://${SHOP_DOMAIN}/p/frame`;
const OTHER_PAGE = `https://${SHOP_DOMAIN}/p/props`;
const MATCH = `https://${OTHER_DOMAIN}/item/frame`;
const wire = z.object({ id: z.string() });
const detailWire = z.object({
  product: wire,
  listings: z.array(z.object({ listing: wire, history: z.array(wire) })),
});
const statusWire = z.object({
  running: z.boolean(),
  latestRun: z.unknown(),
  lastResult: z.unknown(),
});
const created = z.object({ product: z.object({ id: productIdSchema }), listing: z.object({ id: z.string() }) });
const candidates = z.array(z.object({ id: z.string(), url: z.string(), llmVerdict: z.string() }));

let api: ApiHarness;

beforeEach(async () => {
  api = await startApiHarness();
});

afterEach(async () => {
  await api.close();
});

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

const addProduct = async (url = PAGE) => {
  const response = await api.request("POST", apiRoutes.addProduct.url, { url });
  return created.parse(response.json());
};

const searchFinds = (url: string) => {
  api.stores.script.search = ok([{ url, title: "Acme Quad X5 frame kit" }]);
};

describe("Products API", () => {
  it("adds the product behind a pasted URL, answering 201 with the product, listing and first snapshot", async () => {
    const response = await api.request("POST", apiRoutes.addProduct.url, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.Created);
    expect(response.json()).toMatchObject({
      product: { name: LISTING.title, archivedAt: null },
      listing: { url: PAGE, pluginId: SHOP, origin: ListingOrigin.Manual },
      snapshot: { itemPrice: LISTING.itemPrice, shipTo: "IL", inStock: true },
    });
  });

  it("refuses a body without a url with 400 in the error envelope", async () => {
    const response = await api.request("POST", apiRoutes.addProduct.url, { link: PAGE });
    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.InvalidRequest);
  });

  it.each([
    ["a string that is not an http URL", "ftp://shop.example/p", ApiErrorKind.InvalidUrl, "not an absolute http"],
    ["a domain no plugin declares", "https://unknown.example/p", ApiErrorKind.NoPluginForDomain, "unknown.example"],
  ])("answers 422 for %s, naming the reason", async (_label, url, kind, message) => {
    const response = await api.request("POST", apiRoutes.addProduct.url, { url });
    expect(response.statusCode).toBe(HttpStatus.UnprocessableContent);
    const error = errorOf(response.json());
    expect(error.kind).toBe(kind);
    expect(error.message).toContain(message);
  });

  it("answers 422 plugin_unavailable when the plugin for the domain is not loaded", async () => {
    api.stores.answers.set(PAGE, networkError(GatewayRefusal.Unavailable));
    const response = await api.request("POST", apiRoutes.addProduct.url, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.UnprocessableContent);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.PluginUnavailable);
  });

  it("answers 502 fetch_failed with the store's error kind when the store could not fetch the page", async () => {
    api.stores.answers.set(PAGE, { ok: false, error: { kind: StoreErrorKind.Blocked, detail: "captcha" } });
    const response = await api.request("POST", apiRoutes.addProduct.url, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.BadGateway);
    expect(errorOf(response.json())).toEqual({
      kind: ApiErrorKind.FetchFailed,
      message: "the store could not fetch the page: blocked",
    });
  });

  it("answers 409 already_tracked naming the product that tracks the URL", async () => {
    const first = await addProduct();
    const response = await api.request("POST", apiRoutes.addProduct.url, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    const error = errorOf(response.json());
    expect(error.kind).toBe(ApiErrorKind.AlreadyTracked);
    expect(error.message).toBe(`already tracked by product ${first.product.id} "${LISTING.title}"`);
  });

  it("answers a product with its listings and each listing's price history, oldest first", async () => {
    const { product, listing } = await addProduct();
    const [first] = await api.repository.snapshots.latestPerListing(product.id);
    await api.scans.current.scanNow();
    const response = await api.request("GET", `/api/products/${product.id}`);
    expect(response.statusCode).toBe(HttpStatus.Ok);
    const detail = detailWire.parse(response.json());
    expect(detail.product.id).toBe(product.id);
    expect(detail.listings.map((row) => ({ id: row.listing.id, history: row.history.length }))).toEqual([
      { id: listing.id, history: 2 },
    ]);
    expect(detail.listings[0]?.history[0]?.id).toBe(first?.id);
  });

  it("answers 404 product_not_found for an unknown product", async () => {
    const response = await api.request("GET", "/api/products/nope");
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ProductNotFound);
  });
});

describe("Watchlist API", () => {
  const entries = z.array(z.object({
    product: z.object({ id: z.string() }),
    cheapest: z.object({ listingId: z.string(), landedCost: z.object({ currency: z.string() }) }).nullable(),
  }));
  const watchlist = async () => entries.parse((await api.request("GET", "/api/products")).json());

  it("lists the watched products newest first, each with its cheapest landed price", async () => {
    const settings = await api.repository.settings.get();
    await api.repository.settings.save({ ...settings, displayCurrency: "USD" });
    await api.scans.current.scanNow();
    const first = await addProduct();
    const second = await addProduct(OTHER_PAGE);
    const listed = await watchlist();
    expect(listed.map(({ product, cheapest }) => [product.id, cheapest?.listingId, cheapest?.landedCost.currency]))
      .toEqual([[second.product.id, second.listing.id, "USD"], [first.product.id, first.listing.id, "USD"]]);
  });

  it("renames a product, answering 204", async () => {
    const { product } = await addProduct();
    const response = await api.request("PATCH", `/api/products/${product.id}`, { name: "Quad frame" });
    expect(response.statusCode).toBe(HttpStatus.NoContent);
    expect((await api.request("GET", `/api/products/${product.id}`)).json()).toMatchObject({
      product: { name: "Quad frame" },
    });
  });

  it("refuses an empty name with 400", async () => {
    const { product } = await addProduct();
    const response = await api.request("PATCH", `/api/products/${product.id}`, { name: "" });
    expect(response.statusCode).toBe(HttpStatus.BadRequest);
  });

  it("restores a deleted product when its URL is added again, answering 201 with it back in the list", async () => {
    const { product, listing } = await addProduct();
    await api.request("DELETE", `/api/products/${product.id}`);
    const response = await api.request("POST", apiRoutes.addProduct.url, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.Created);
    expect(response.json())
      .toMatchObject({ product: { id: product.id, archivedAt: null }, listing: { id: listing.id } });
    expect((await watchlist()).map((entry) => entry.product.id)).toEqual([product.id]);
  });

  it("deletes a product by archiving it: gone from the list, its detail and its candidates", async () => {
    const { product } = await addProduct();
    const response = await api.request("DELETE", `/api/products/${product.id}`);
    expect(response.statusCode).toBe(HttpStatus.NoContent);
    expect(await watchlist()).toEqual([]);
    for (const [method, url] of [
      ["GET", `/api/products/${product.id}`],
      ["GET", `/api/products/${product.id}/candidates`],
      ["PATCH", `/api/products/${product.id}`],
      ["DELETE", `/api/products/${product.id}`],
    ] as const) {
      const refused = await api.request(method, url, method === "PATCH" ? { name: "x" } : undefined);
      expect({ url, status: refused.statusCode, kind: errorOf(refused.json()).kind })
        .toEqual({ url, status: HttpStatus.NotFound, kind: ApiErrorKind.ProductNotFound });
    }
  });
});

describe("Listings API", () => {
  it("adds a pasted URL to a product as a manual listing, answering 201", async () => {
    const { product } = await addProduct();
    const response = await api.request("POST", `/api/products/${product.id}/listings`, { url: OTHER_PAGE });
    expect(response.statusCode).toBe(HttpStatus.Created);
    expect(response.json()).toMatchObject({ listing: { productId: product.id, url: OTHER_PAGE } });
  });

  it("answers 404 product_not_found when the product does not exist", async () => {
    const response = await api.request("POST", "/api/products/nope/listings", { url: OTHER_PAGE });
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ProductNotFound);
  });

  it("removes a listing from its product, answering 204, so its detail no longer shows it", async () => {
    const { product, listing } = await addProduct();
    const second = await api.request("POST", `/api/products/${product.id}/listings`, { url: OTHER_PAGE });
    const kept = z.object({ listing: wire }).parse(second.json()).listing.id;
    const response = await api.request("DELETE", `/api/products/${product.id}/listings/${listing.id}`);
    expect(response.statusCode).toBe(HttpStatus.NoContent);
    const detail = detailWire.parse((await api.request("GET", `/api/products/${product.id}`)).json());
    expect(detail.listings.map((row) => row.listing.id)).toEqual([kept]);
  });

  it("answers 404 listing_not_found for a listing that is not the product's or already removed", async () => {
    const { product, listing } = await addProduct();
    await api.request("DELETE", `/api/products/${product.id}/listings/${listing.id}`);
    for (const id of [listing.id, "nope"]) {
      const response = await api.request("DELETE", `/api/products/${product.id}/listings/${id}`);
      expect({ status: response.statusCode, kind: errorOf(response.json()).kind })
        .toEqual({ status: HttpStatus.NotFound, kind: ApiErrorKind.ListingNotFound });
    }
  });

  it("answers 404 product_not_found when removing a listing of an archived product", async () => {
    const { product, listing } = await addProduct();
    await api.request("DELETE", `/api/products/${product.id}`);
    const response = await api.request("DELETE", `/api/products/${product.id}/listings/${listing.id}`);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ProductNotFound);
  });

  it("answers 404 product_not_found when adding a listing to an archived product", async () => {
    const { product } = await addProduct();
    await api.request("DELETE", `/api/products/${product.id}`);
    const response = await api.request("POST", `/api/products/${product.id}/listings`, { url: OTHER_PAGE });
    expect({ status: response.statusCode, kind: errorOf(response.json()).kind })
      .toEqual({ status: HttpStatus.NotFound, kind: ApiErrorKind.ProductNotFound });
  });

  it("answers 409 already_tracked naming the product for a URL another listing tracks", async () => {
    const { product } = await addProduct();
    const other = await addProduct(OTHER_PAGE);
    const response = await api.request("POST", `/api/products/${other.product.id}/listings`, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    expect(errorOf(response.json()).message).toContain(product.id);
  });

  it("makes a removed listing active again when its URL is added to its product, answering 201", async () => {
    const { product, listing } = await addProduct();
    await api.request("DELETE", `/api/products/${product.id}/listings/${listing.id}`);
    const response = await api.request("POST", `/api/products/${product.id}/listings`, { url: PAGE });
    expect(response.statusCode).toBe(HttpStatus.Created);
    const detail = detailWire.parse((await api.request("GET", `/api/products/${product.id}`)).json());
    expect(detail.listings.map((row) => row.listing.id)).toEqual([listing.id]);
  });
});

describe("Match candidates API", () => {
  const findMatches = async (productId: string) => api.request("POST", `/api/products/${productId}/candidates/search`);

  it("searches the other stores and saves the results as pending candidates, unjudged without a key", async () => {
    const { product } = await addProduct();
    searchFinds(MATCH);
    const response = await findMatches(product.id);
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.json()).toMatchObject({
      candidates: [{ url: MATCH, pluginId: OTHER, llmVerdict: "unjudged" }],
      failedSearches: [],
      foreignResults: [],
    });
  });

  it("reports a failed search with the store's error", async () => {
    const { product } = await addProduct();
    api.stores.script.search = networkError("down");
    const response = await findMatches(product.id);
    expect(response.json()).toMatchObject({
      failedSearches: [{ pluginId: OTHER, error: { kind: StoreErrorKind.Network } }],
    });
  });

  it("lists a product's pending candidates", async () => {
    const { product } = await addProduct();
    searchFinds(MATCH);
    await findMatches(product.id);
    const response = await api.request("GET", `/api/products/${product.id}/candidates`);
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(candidates.parse(response.json()).map(({ url }) => url)).toEqual([MATCH]);
  });

  it("leaves other products' candidates out of a product's list", async () => {
    const { product } = await addProduct();
    searchFinds(MATCH);
    await findMatches(product.id);
    const other = await addProduct(OTHER_PAGE);
    expect((await api.request("GET", `/api/products/${other.product.id}/candidates`)).json()).toEqual([]);
  });

  it.each([
    ["listing", "GET", "/api/products/nope/candidates"],
    ["searching", "POST", "/api/products/nope/candidates/search"],
  ] as const)("answers 404 product_not_found when %s candidates of an unknown product", async (_label, method, url) => {
    const response = await api.request(method, url);
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ProductNotFound);
  });

  it("answers 409 no_source_listing for a product without a manual listing", async () => {
    const at = new Date();
    const product = productSchema.parse({
      id: "p-1",
      name: "x",
      createdAt: at,
      archivedAt: null,
      cheapestListingId: null,
    });
    const listing = listingSchema.parse({
      id: "l-1",
      productId: product.id,
      pluginId: SHOP,
      url: PAGE,
      title: "x",
      status: ListingStatus.Active,
      origin: ListingOrigin.Matched,
      addedAt: at,
      failureStreak: 0,
      notFoundStreak: 0,
    });
    const snapshot = priceSnapshotSchema.parse({
      id: "s-1",
      listingId: listing.id,
      observedAt: at,
      shipTo: "IL",
      itemPrice: LISTING.itemPrice,
      shipping: LISTING.shipping,
      inStock: true,
    });
    await api.repository.products.add(product, listing, snapshot);
    const response = await findMatches(product.id);
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.NoSourceListing);
  });

  it("answers 409 already_suggested when another search saved the same results meanwhile", async () => {
    const { product } = await addProduct();
    searchFinds(MATCH);
    const [first, second] = await Promise.all([findMatches(product.id), findMatches(product.id)]);
    expect([first.statusCode, second.statusCode].toSorted()).toEqual([HttpStatus.Ok, HttpStatus.Conflict]);
    const refused = first.statusCode === HttpStatus.Conflict ? first : second;
    expect(errorOf(refused.json()).kind).toBe(ApiErrorKind.AlreadySuggested);
  });

  const pendingId = async (): Promise<string> => {
    const { product } = await addProduct();
    searchFinds(MATCH);
    const response = await findMatches(product.id);
    return z.object({ candidates: candidates }).parse(response.json()).candidates[0]?.id ?? "";
  };

  it("accepts a pending candidate as a matched listing, answering 201", async () => {
    const id = await pendingId();
    const response = await api.request("POST", `/api/candidates/${id}/accept`);
    expect(response.statusCode).toBe(HttpStatus.Created);
    expect(response.json()).toMatchObject({ listing: { url: MATCH, origin: ListingOrigin.Matched } });
  });

  it("rejects a pending candidate, answering 204, so it is no longer pending", async () => {
    const id = await pendingId();
    const response = await api.request("POST", `/api/candidates/${id}/reject`);
    expect(response.statusCode).toBe(HttpStatus.NoContent);
    expect(response.body).toBe("");
    expect((await api.request("POST", `/api/candidates/${id}/accept`)).statusCode).toBe(HttpStatus.NotFound);
  });

  it.each(["accept", "reject"])("answers 404 not_pending when asked to %s an unknown candidate", async (action) => {
    const response = await api.request("POST", `/api/candidates/nope/${action}`);
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.NotPending);
  });

  it("answers 502 fetch_failed and keeps the candidate pending when its page cannot be fetched", async () => {
    const id = await pendingId();
    api.stores.answers.set(MATCH, { ok: false, error: { kind: StoreErrorKind.Timeout, detail: "slow" } });
    const response = await api.request("POST", `/api/candidates/${id}/accept`);
    expect(response.statusCode).toBe(HttpStatus.BadGateway);
    expect((await api.request("POST", `/api/candidates/${id}/reject`)).statusCode).toBe(HttpStatus.NoContent);
  });

  it("answers 422 plugin_unavailable when the candidate's plugin is not loaded", async () => {
    const id = await pendingId();
    api.stores.answers.set(MATCH, networkError(GatewayRefusal.Unavailable));
    const response = await api.request("POST", `/api/candidates/${id}/accept`);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.PluginUnavailable);
  });

  it("answers 404 product_not_found when accepting a candidate of an archived product", async () => {
    const id = await pendingId();
    const [pending] = await api.repository.matchCandidates.listPending();
    await api.request("DELETE", `/api/products/${pending?.productId ?? ""}`);
    const response = await api.request("POST", `/api/candidates/${id}/accept`);
    expect({ status: response.statusCode, kind: errorOf(response.json()).kind })
      .toEqual({ status: HttpStatus.NotFound, kind: ApiErrorKind.ProductNotFound });
  });

  it("answers 409 already_tracked when a listing started tracking the candidate's URL", async () => {
    const id = await pendingId();
    await addProduct(MATCH);
    const response = await api.request("POST", `/api/candidates/${id}/accept`);
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.AlreadyTracked);
  });
});

describe("Alerts API", () => {
  const seedAlerts = async (): Promise<Alert[]> => {
    const { product, listing } = await addProduct();
    const [snapshot] = await api.repository.snapshots.latestPerListing(product.id);
    if (snapshot === undefined) {
      throw new Error("the product has no snapshot");
    }
    const alert = (id: string, at: number): Alert => alertSchema.parse({
      id,
      productId: product.id,
      listingId: listing.id,
      kind: AlertKind.BackInStock,
      beforeSnapshotId: null,
      afterSnapshotId: snapshot.id,
      createdAt: new Date(at),
      readAt: null,
    });
    const alerts = [alert("a-1", 0), alert("a-2", 1)];
    for (const row of alerts) {
      await api.repository.alerts.save(row);
    }
    return alerts;
  };

  const ids = (body: unknown): string[] => z.array(z.object({ id: z.string() })).parse(body).map(({ id }) => id);

  it("lists every alert newest first", async () => {
    await seedAlerts();
    const response = await api.request("GET", apiRoutes.listAlerts.url);
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(ids(response.json())).toEqual(["a-2", "a-1"]);
  });

  it("marks one alert read, answering 204, and lists only unread ones with unread=true", async () => {
    await seedAlerts();
    expect((await api.request("POST", "/api/alerts/a-2/read")).statusCode).toBe(HttpStatus.NoContent);
    expect(ids((await api.request("GET", "/api/alerts?unread=true")).json())).toEqual(["a-1"]);
    expect(ids((await api.request("GET", "/api/alerts?unread=false")).json())).toEqual(["a-2", "a-1"]);
  });

  it("answers 404 alert_not_found when marking an unknown alert read, unlike an unknown path", async () => {
    const response = await api.request("POST", "/api/alerts/nope/read");
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.AlertNotFound);
    expect(errorOf((await api.request("POST", "/api/alerts/nope/unread")).json()).kind).toBe(ApiErrorKind.NotFound);
  });

  it("marks every unread alert read and says how many", async () => {
    await seedAlerts();
    await api.request("POST", "/api/alerts/a-1/read");
    const response = await api.request("POST", apiRoutes.markAllAlertsRead.url);
    expect(response.json()).toEqual({ marked: 1 });
    expect((await api.request("GET", "/api/alerts?unread=true")).json()).toEqual([]);
  });

  it("refuses an unread filter that is not a boolean with 400", async () => {
    expect((await api.request("GET", "/api/alerts?unread=maybe")).statusCode).toBe(HttpStatus.BadRequest);
  });
});

describe("Settings API", () => {
  it("answers the defaults before any settings were saved", async () => {
    const response = await api.request("GET", apiRoutes.getSettings.url);
    expect(response.json()).toMatchObject({ shipToCountry: "IL", displayCurrency: "ILS", scanIntervalHours: 12 });
  });

  it("replaces the settings through the runtime and answers them", async () => {
    const saved = await api.request("GET", apiRoutes.getSettings.url);
    const current = z.record(z.string(), z.unknown()).parse(saved.json());
    const next = { ...current, displayCurrency: "USD", scanIntervalHours: 6 };
    const response = await api.request("PUT", apiRoutes.putSettings.url, next);
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.json()).toEqual(next);
    expect(api.applySettings).toHaveBeenCalledTimes(1);
    expect((await api.request("GET", apiRoutes.getSettings.url)).json()).toEqual(next);
  });

  it.each([
    ["it is shutting down", ApiErrorKind.ShuttingDown],
    ["the change was not applied", ApiErrorKind.SettingsNotApplied],
  ] as const)("answers 503 to a change the runtime refuses because %s, naming the kind", async (_label, kind) => {
    const saved = await api.request("GET", apiRoutes.getSettings.url);
    const current = z.record(z.string(), z.unknown()).parse(saved.json());
    api.applySettings.mockResolvedValueOnce(err({ kind }));
    const response = await api.request("PUT", apiRoutes.putSettings.url, current);
    expect(response.statusCode).toBe(HttpStatus.ServiceUnavailable);
    expect(errorOf(response.json()).kind).toBe(kind);
  });

  it("refuses settings that fail the schema with 400 and changes nothing", async () => {
    const response = await api.request("PUT", apiRoutes.putSettings.url, { displayCurrency: "XXX" });
    expect(response.statusCode).toBe(HttpStatus.BadRequest);
    expect(api.applySettings).not.toHaveBeenCalled();
  });
});

describe("Plugins API", () => {
  it("answers the runtime's plugin rows", async () => {
    api.rows.current = [{ source: "plugins.json", manifest: null, status: "disabled", issues: [] }];
    const response = await api.request("GET", apiRoutes.listPlugins.url);
    expect(response.json()).toEqual(api.rows.current);
  });
});

describe("Scan API", () => {
  const status = async () => statusWire.parse((await api.request("GET", apiRoutes.getScan.url)).json());

  it("starts a scan in the background, answering 202 while it runs, then reports its result", async () => {
    await addProduct();
    const response = await api.request("POST", apiRoutes.startScan.url);
    expect(response.statusCode).toBe(HttpStatus.Accepted);
    expect(statusWire.parse(response.json()).running).toBe(true);
    await vi.waitFor(async () => {
      expect((await status()).running).toBe(false);
    });
    expect(await status()).toMatchObject({
      latestRun: { pluginId: SHOP, outcome: "ok" },
      lastResult: { plugins: [{ succeeded: 1, failed: 0 }], alerts: 0, transitions: 0 },
    });
  });

  it("answers 409 scan_running to a second request while the first scan runs", async () => {
    await addProduct();
    let release = (): void => undefined;
    api.stores.script.fetching = new Promise((resolve) => {
      release = resolve;
    });
    await api.request("POST", apiRoutes.startScan.url);
    const response = await api.request("POST", apiRoutes.startScan.url);
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ScanRunning);
    release();
    await vi.waitFor(async () => {
      expect((await status()).running).toBe(false);
    });
  });

  it("answers 409 scan_running while a scan it did not start runs, and reports that scan", async () => {
    await addProduct();
    let release = (): void => undefined;
    api.stores.script.fetching = new Promise((resolve) => {
      release = resolve;
    });
    const scheduled = api.scans.current.scanNow();
    expect((await status()).running).toBe(true);
    const response = await api.request("POST", apiRoutes.startScan.url);
    expect(response.statusCode).toBe(HttpStatus.Conflict);
    release();
    await scheduled;
    expect(await status()).toMatchObject({ running: false, lastResult: { plugins: [{ succeeded: 1 }] } });
  });

  it("answers no recorded run before any listing was scanned, and the empty boot scan as the last result", async () => {
    expect(await status()).toMatchObject({
      running: false,
      latestRun: null,
      lastResult: { plugins: [], alerts: 0, transitions: 0 },
    });
  });

  it("logs a scan that could not start because the schedule stopped", async () => {
    await api.scans.current.stop();
    await api.request("POST", apiRoutes.startScan.url);
    await vi.waitFor(() => {
      expect(api.logger.events.map(({ message }) => message)).toContain("scan not started");
    });
  });

  it("logs a scan that threw and is ready for the next one", async () => {
    const scanNow = async () => Promise.reject(new Error("disk full"));
    api.scans.current = { scanNow, stop: async () => Promise.resolve(), scanning: () => false, lastReport: () => null };
    await api.request("POST", apiRoutes.startScan.url);
    await vi.waitFor(async () => {
      expect((await status()).running).toBe(false);
    });
    expect(api.logger.events.map(({ message }) => message)).toContain("scan failed");
  });
});

describe("API during a settings restart", () => {
  it.each([
    ["adding a product", apiRoutes.addProduct.url, { url: PAGE }],
    ["adding a listing", "/api/products/p/listings", { url: OTHER_PAGE }],
    ["searching for matches", "/api/products/p/candidates/search", undefined],
    ["accepting a candidate", "/api/candidates/c/accept", undefined],
    ["starting a scan", apiRoutes.startScan.url, undefined],
  ])("answers 503 restarting to %s, which needs the plugins", async (_label, url, payload) => {
    api.restarting.current = true;
    const response = await api.request("POST", url, payload);
    expect(response.statusCode).toBe(HttpStatus.ServiceUnavailable);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.Restarting);
  });

  it("starts no scan while restarting", async () => {
    const { current } = api.scans;
    const scanNow = vi.fn(async () => current.scanNow());
    api.scans.current = { ...current, scanNow };
    api.restarting.current = true;
    await api.request("POST", apiRoutes.startScan.url);
    expect(scanNow).not.toHaveBeenCalled();
  });
});

describe("API during shutdown", () => {
  it("answers 503 shutting_down to starting a scan and starts none", async () => {
    const { current } = api.scans;
    const scanNow = vi.fn(async () => current.scanNow());
    api.scans.current = { ...current, scanNow };
    api.stopping.current = true;
    const response = await api.request("POST", apiRoutes.startScan.url);
    expect(response.statusCode).toBe(HttpStatus.ServiceUnavailable);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.ShuttingDown);
    expect(scanNow).not.toHaveBeenCalled();
  });
});

const routeList = Object.values(apiRoutes).map(({ method, url }) => ({ method, url: url.replaceAll(/:\w+/gu, "x") }));
const mutating = routeList.filter(({ method }) => method !== "GET");

describe("API guards", () => {
  it.each(mutating)("refuses $method $url from another origin with 403", async ({ method, url }) => {
    const response = await api.server.inject({ method, url, headers: { ...API_HOST, origin: "https://evil.example" } });
    expect(response.statusCode).toBe(HttpStatus.Forbidden);
    expect(errorOf(response.json()).kind).toBe(ApiErrorKind.CrossOrigin);
  });

  it.each(routeList)("answers $method $url with 503 while the app is starting", async ({ method, url }) => {
    const starting = { isReady: () => false, openWhileStarting: [] };
    const server = createServer({ port: API_PORT, logger: recordingLogger(), ...starting });
    registerApiRoutes(server);
    const response = await server.inject({ method, url, headers: API_HOST });
    await server.close();
    expect(response.statusCode).toBe(HttpStatus.ServiceUnavailable);
  });

  it("answers 500 without detail when a route is reached before the runtime is attached", async () => {
    const logger = recordingLogger();
    const server = createServer({ port: API_PORT, logger, isReady: () => true, openWhileStarting: [] });
    registerApiRoutes(server);
    const response = await server.inject({ method: "GET", url: apiRoutes.getSettings.url, headers: API_HOST });
    await server.close();
    expect(response.statusCode).toBe(HttpStatus.InternalServerError);
    expect(response.body).not.toContain(NOT_ATTACHED);
  });
});
