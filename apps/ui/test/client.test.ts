import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { listingIdSchema, snapshotIdSchema } from "@fpving/core";
import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AlreadyTrackedFailure, ApiFailure, ClientErrorKind, createClient, reviveDates } from "../src/client.ts";
import {
  alreadyTracked, emptyTrend, failWith, fakeApi, product, reply, unreadAlert, wire,
} from "./support/fake-api.ts";

const USD_12 = { amountMinor: 1200, currency: "USD" } as const;
const PAGE = "https://shop.example/item/frame";

const failureOf = async (promise: Promise<unknown>): Promise<ApiFailure> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiFailure) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
};

describe("API client", () => {
  it("parses the watchlist with its dates as dates and its trend gaps kept as nulls", async () => {
    const api = fakeApi();
    const trend = [...emptyTrend().slice(1), USD_12];
    const row = { product: product("p1", "Frame"), cheapest: null, trend, unreadAlerts: 0 };
    api.on(apiRoutes.listProducts, reply(wire.watchlist, [row]));
    const [parsed] = await api.client.listProducts();
    expect(parsed?.product.createdAt).toEqual(new Date("2026-10-01T08:00:00.000Z"));
    expect(parsed?.product.archivedAt).toBeNull();
    expect(parsed?.trend.at(0)).toBeNull();
    expect(parsed?.trend.at(-1)).toEqual(USD_12);
  });

  it("sends the pasted URL as JSON to the add product route and returns what was created", async () => {
    const api = fakeApi();
    const created = {
      product: product("p1", "Frame"),
      listing: {
        id: listingIdSchema.parse("p1-l1"), productId: product("p1", "Frame").id, pluginId: "shop",
        url: PAGE, title: "Frame", status: "active", origin: "manual", addedAt: new Date(0), failureStreak: 0,
        notFoundStreak: 0,
      },
      snapshot: {
        id: snapshotIdSchema.parse("s1"), listingId: listingIdSchema.parse("p1-l1"), observedAt: new Date(0),
        shipTo: "IL", itemPrice: USD_12, shipping: { kind: ShippingKind.Unknown }, inStock: true,
      },
    };
    api.on(apiRoutes.addProduct, reply(wire.added, wire.added.parse(created), HttpStatus.Created));
    const answer = await api.client.addProduct({ url: PAGE });
    expect(api.sent).toEqual([{ method: "POST", path: apiRoutes.addProduct.url, body: { url: PAGE } }]);
    expect(answer.snapshot.observedAt).toEqual(new Date(0));
  });

  it("asks for the unread alerts only when told to", async () => {
    const api = fakeApi();
    api.on(apiRoutes.listAlerts, reply(wire.alerts, [unreadAlert("a1", "p1")]), "?unread=true");
    const alerts = await api.client.listAlerts({ unread: "true" });
    expect(alerts.map(({ id }) => id)).toEqual(["a1"]);
    expect(alerts[0]?.readAt).toBeNull();
    api.on(apiRoutes.listAlerts, reply(wire.alerts, []));
    expect(await api.client.listAlerts({ unread: undefined })).toEqual([]);
  });

  it("throws the kind and message of an error envelope", async () => {
    const api = fakeApi();
    api.on(apiRoutes.addProduct, failWith(HttpStatus.UnprocessableContent, ApiErrorKind.InvalidUrl, "not a URL"));
    const failure = await failureOf(api.client.addProduct({ url: PAGE }));
    expect(failure.kind).toBe(ApiErrorKind.InvalidUrl);
    expect(failure.message).toBe("not a URL");
  });

  it.each([
    ["a success answer that breaks the route schema", () => Response.json([{ product: {} }])],
    ["an error answer that is not the envelope", () => Response.json({ oops: true }, { status: 500 })],
    ["an answer that is not JSON", () => new Response("<h1>oops</h1>", { status: 500 })],
    ["an empty success answer", () => new Response(null, { status: HttpStatus.Ok })],
  ])("throws bad_response for %s", async (_label, answer) => {
    const api = fakeApi();
    api.on(apiRoutes.listProducts, answer);
    expect((await failureOf(api.client.listProducts())).kind).toBe(ClientErrorKind.BadResponse);
  });

  it("builds the path from the route's path with each param percent-encoded", async () => {
    const api = fakeApi();
    await failureOf(api.client.removeListing({ productId: "p 1/2", listingId: "l?1" }));
    expect(api.sent.map(({ method, path }) => `${method} ${path}`))
      .toEqual(["DELETE /api/products/p%201%2F2/listings/l%3F1"]);
  });

  it("reads a 204 answer as no body", async () => {
    const api = fakeApi();
    api.on({ method: "POST", url: "/api/alerts/a1/read" }, () => new Response(null, { status: HttpStatus.NoContent }));
    expect(await api.client.markAlertRead({ alertId: "a1" })).toBeNull();
  });

  it("throws an already_tracked failure that carries the product that tracks the URL", async () => {
    const api = fakeApi();
    api.on(apiRoutes.addProduct, alreadyTracked("p1", "Frame"));
    const failure = await failureOf(api.client.addProduct({ url: PAGE }));
    expect(failure).toBeInstanceOf(AlreadyTrackedFailure);
    expect(failure.kind).toBe(ApiErrorKind.AlreadyTracked);
    expect(failure instanceof AlreadyTrackedFailure ? failure.product : null).toEqual({ id: "p1", name: "Frame" });
  });

  it("throws bad_response for an already_tracked answer that does not name the product", async () => {
    const api = fakeApi();
    const body = { error: { kind: ApiErrorKind.AlreadyTracked, message: "already tracked" } };
    api.on(apiRoutes.addProduct, () => Response.json(body, { status: HttpStatus.Conflict }));
    expect((await failureOf(api.client.addProduct({ url: PAGE }))).kind).toBe(ClientErrorKind.BadResponse);
  });

  it("throws unreachable when the request cannot be sent", async () => {
    const client = createClient(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect((await failureOf(client.listProducts())).kind).toBe(ClientErrorKind.Unreachable);
  });
});

describe("Date revival", () => {
  const schema = z.object({ at: z.date(), maybe: z.date().nullable(), list: z.array(z.date()) });

  it("turns ISO strings at date positions into dates and leaves other fields alone", () => {
    const iso = "2026-10-31T00:00:00.000Z";
    expect(reviveDates(schema, { at: iso, maybe: null, list: [iso], extra: iso })).toEqual({
      at: new Date(iso), maybe: null, list: [new Date(iso)], extra: iso,
    });
  });

  it("leaves a value of an unexpected shape as it is, so the parse after it rejects it", () => {
    const odd = { at: 1, maybe: 2, list: "x" };
    expect(reviveDates(schema, odd)).toEqual(odd);
    expect(reviveDates(schema, "x")).toBe("x");
    expect(schema.safeParse(reviveDates(schema, odd)).success).toBe(false);
  });
});
