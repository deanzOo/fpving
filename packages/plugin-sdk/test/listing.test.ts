import { describe, expect, it } from "vitest";
import { fetchedListingSchema, searchCandidateSchema, ShippingKind, ShippingUnknown } from "../src/listing.ts";

const PRICE = 4599;
const SHIPPING = 500;
const NEGATIVE = -1;
const FRACTIONAL = 45.99;

const listing = {
  title: "Example 5in FPV frame",
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "USD" },
  inStock: true,
  images: ["https://cdn.example.com/frame.jpg"],
};

const rejects = (override: Record<string, unknown>): boolean =>
  !fetchedListingSchema.safeParse({ ...listing, ...override }).success;

describe("Fetched listing", () => {
  it("accepts a listing with known shipping", () => {
    expect(fetchedListingSchema.parse(listing)).toEqual(listing);
  });

  it("accepts unknown shipping, which is never treated as zero", () => {
    expect(rejects({ shipping: ShippingUnknown })).toBe(false);
  });

  it("accepts free shipping", () => {
    expect(rejects({ shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" } })).toBe(false);
  });

  it.each([
    ["zero, a store placeholder price", 0],
    ["a negative amount", NEGATIVE],
    ["a fractional amount", FRACTIONAL],
  ])("rejects an item price of %s", (_name, amountMinor) => {
    expect(rejects({ itemPrice: { amountMinor, currency: "USD" } })).toBe(true);
  });

  it("rejects an unknown currency", () => {
    expect(rejects({ itemPrice: { amountMinor: PRICE, currency: "BTC" } })).toBe(true);
  });

  it("rejects negative shipping", () => {
    expect(rejects({ shipping: { kind: ShippingKind.Known, amountMinor: NEGATIVE, currency: "USD" } })).toBe(true);
  });

  it("rejects shipping without a kind", () => {
    expect(rejects({ shipping: { amountMinor: SHIPPING, currency: "USD" } })).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(rejects({ title: "  " })).toBe(true);
  });

  it.each(["/frame.jpg", "javascript:alert(1)", "data:image/png;base64,AA=="])("rejects the image url %j", (image) => {
    expect(rejects({ images: [image] })).toBe(true);
  });
});

describe("Search candidate", () => {
  it("accepts a candidate with and without an item price", () => {
    const candidate = { url: "https://example.com/p/1", title: "Example frame" };
    expect(searchCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(searchCandidateSchema.safeParse({ ...candidate, itemPrice: listing.itemPrice }).success).toBe(true);
  });

  it("rejects a relative candidate url", () => {
    expect(searchCandidateSchema.safeParse({ url: "/p/1", title: "Example frame" }).success).toBe(false);
  });
});
