import { describe, expect, expectTypeOf, it } from "vitest";
import type { BrowserDriver, BrowserPage, HttpClient, HttpResponse } from "../src/context.ts";
import { StoreErrorKind } from "../src/errors.ts";
import type { StoreError } from "../src/errors.ts";
import { ShippingKind } from "../src/listing.ts";
import type { FetchedListing, SearchCandidate } from "../src/listing.ts";
import type { Store } from "../src/plugin.ts";

const HTTP_OK = 200;
const PRICE = 4599;
const SHIPPING = 500;
const PAGE_URL = "https://shop.example.com/p/1";

const listing: FetchedListing = {
  title: "Example frame",
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "USD" },
  inStock: true,
  images: ["https://cdn.example.com/frame.jpg"],
};
const error: StoreError = { kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: "<html></html>" };
const browserPage: BrowserPage = { status: HTTP_OK, html: "<html></html>", finalUrl: PAGE_URL };
const httpResponse: HttpResponse = { status: HTTP_OK, body: "{}", headers: { "content-type": "application/json" } };
const candidate: SearchCandidate = { url: PAGE_URL, title: "Example frame", itemPrice: listing.itemPrice };

describe("host and plugin boundary values", () => {
  it.each<[string, unknown]>([
    ["a fetched listing", listing],
    ["a store error", error],
    ["a browser page", browserPage],
    ["an http response", httpResponse],
    ["a search candidate", candidate],
  ])("round-trips %s through structuredClone, as worker threads require", (_name, value) => {
    expect(structuredClone(value)).toEqual(value);
  });

  it("passes urls between host and plugin as strings, never URL objects", () => {
    expectTypeOf<Parameters<Store["fetchListing"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<HttpClient["get"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<BrowserDriver["fetchPage"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<BrowserPage["finalUrl"]>().toEqualTypeOf<string>();
  });
});
