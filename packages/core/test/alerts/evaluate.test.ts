import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { AlertKind, ListingStatus, listingIdSchema, productIdSchema, snapshotIdSchema } from "../../src/index.ts";
import type { Listing, PriceSnapshot } from "../../src/index.ts";
import { evaluate } from "../../src/alerts/evaluate.ts";
import type { EvaluateInput } from "../../src/alerts/evaluate.ts";
import { NOW, daysAgo, listing, rates, settings, snapshot, withLatest } from "./builders.ts";

const HUNDRED = 10_000;
const EXACTLY_FIVE_PERCENT = 9500;
const JUST_OVER_FIVE_PERCENT = 9501;
const SIX_PERCENT = 9400;
const TWO_PERCENT = 9800;
const AGE = { two: 2, three: 3, five: 5, ten: 10, twenty: 20, thirty: 30, thirtyOne: 31, forty: 40, fifty: 50 };
const DOUBLE = 20_000;
const HIGHER = 11_000;
const LOWER = 9000;

const subject = listing("a");
const productId = productIdSchema.parse("p1");
const listingA = listingIdSchema.parse("a");
const listingB = listingIdSchema.parse("b");

const priced = (id: string, amountMinor: number, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot =>
  snapshot(id, "a", { itemPrice: { amountMinor, currency: "USD" }, ...overrides });

const dropInput = (incoming: PriceSnapshot, history: PriceSnapshot[]): EvaluateInput => ({
  listing: subject,
  history,
  incoming,
  productListings: [withLatest(subject, incoming)],
  previousCheapestListingId: listingA,
  rates,
  settings,
  now: NOW,
});

const kinds = (input: EvaluateInput) => evaluate(input).alerts.map((alert) => alert.kind);

describe("Price drop alert", () => {
  it("does not fire on a listing's first snapshot", () => {
    expect(kinds(dropInput(priced("s1", HUNDRED), []))).toEqual([]);
  });

  it("fires when the item price is a new 30-day low at least 5% below the previous low", () => {
    const history = [
      priced("s0", HIGHER, { observedAt: daysAgo(AGE.ten) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.five) }),
    ];
    const incoming = priced("s2", SIX_PERCENT);
    const result = evaluate(dropInput(incoming, history));
    expect(result.alerts).toEqual([
      {
        kind: AlertKind.PriceDrop,
        productId,
        listingId: listingA,
        beforeSnapshotId: snapshotIdSchema.parse("s1"),
        afterSnapshotId: snapshotIdSchema.parse("s2"),
        createdAt: NOW,
      },
    ]);
  });

  it("fires when the drop is exactly 5% below the previous low", () => {
    const input = dropInput(priced("s2", EXACTLY_FIVE_PERCENT), [priced("s1", HUNDRED)]);
    expect(kinds(input)).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire when the drop is just under 5% below the previous low", () => {
    expect(kinds(dropInput(priced("s2", JUST_OVER_FIVE_PERCENT), [priced("s1", HUNDRED)]))).toEqual([]);
  });

  it("does not fire when the new low is less than 5% below the previous low", () => {
    expect(kinds(dropInput(priced("s2", TWO_PERCENT), [priced("s1", HUNDRED)]))).toEqual([]);
  });

  it("does not fire when the incoming price is not the lowest in the window", () => {
    const history = [
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.twenty) }),
      priced("s1", SIX_PERCENT, { observedAt: daysAgo(AGE.ten) }),
    ];
    expect(kinds(dropInput(priced("s2", EXACTLY_FIVE_PERCENT), history))).toEqual([]);
  });

  it("compares against the lowest price in the window", () => {
    const history = [
      priced("s0", HIGHER, { observedAt: daysAgo(AGE.twenty) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.ten) }),
    ];
    const result = evaluate(dropInput(priced("s2", SIX_PERCENT), history));
    expect(result.alerts.map((alert) => alert.beforeSnapshotId)).toEqual([snapshotIdSchema.parse("s1")]);
  });

  it("ignores a lower price older than 30 days", () => {
    const history = [
      priced("s0", LOWER, { observedAt: daysAgo(AGE.thirtyOne) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.five) }),
    ];
    expect(kinds(dropInput(priced("s2", SIX_PERCENT), history))).toEqual([AlertKind.PriceDrop]);
  });

  it("counts a snapshot observed exactly 30 days ago", () => {
    const history = [priced("s0", HUNDRED, { observedAt: daysAgo(AGE.thirty) })];
    expect(kinds(dropInput(priced("s2", SIX_PERCENT), history))).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire when the window holds no earlier snapshot", () => {
    const history = [priced("s0", HUNDRED, { observedAt: daysAgo(AGE.forty) })];
    expect(kinds(dropInput(priced("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("never compares snapshots quoted for different destinations", () => {
    const history = [priced("s0", HUNDRED, { shipTo: "US" })];
    expect(kinds(dropInput(priced("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("never compares prices in different currencies, so an exchange rate change alone raises nothing", () => {
    const history = [priced("s0", HUNDRED, { itemPrice: { amountMinor: HUNDRED, currency: "ILS" } })];
    expect(kinds(dropInput(priced("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("compares item prices only, so changed shipping raises nothing", () => {
    const history = [priced("s0", HUNDRED)];
    const incoming = priced("s2", HUNDRED, { shipping: { kind: ShippingKind.Unknown } });
    expect(kinds(dropInput(incoming, history))).toEqual([]);
  });

  it("fires on any strict new low when the threshold is zero", () => {
    const input = {
      ...dropInput(priced("s2", HUNDRED - 1), [priced("s1", HUNDRED)]),
      settings: { ...settings, priceDropMinBasisPoints: 0 },
    };
    expect(kinds(input)).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire on an equal price when the threshold is zero", () => {
    const input = {
      ...dropInput(priced("s2", HUNDRED), [priced("s1", HUNDRED)]),
      settings: { ...settings, priceDropMinBasisPoints: 0 },
    };
    expect(kinds(input)).toEqual([]);
  });
});

describe("Back in stock alert", () => {
  const back = (history: PriceSnapshot[], incoming: PriceSnapshot) => evaluate(dropInput(incoming, history));

  it("fires when the previous snapshot was out of stock and the incoming one is in stock", () => {
    const result = back([priced("s1", HUNDRED, { inStock: false })], priced("s2", HUNDRED));
    expect(result.alerts).toEqual([
      {
        kind: AlertKind.BackInStock,
        productId,
        listingId: listingA,
        beforeSnapshotId: snapshotIdSchema.parse("s1"),
        afterSnapshotId: snapshotIdSchema.parse("s2"),
        createdAt: NOW,
      },
    ]);
  });

  it("does not fire when the listing stayed in stock", () => {
    expect(back([priced("s1", HUNDRED)], priced("s2", HUNDRED)).alerts).toEqual([]);
  });

  it("does not fire when the listing stayed out of stock", () => {
    const history = [priced("s1", HUNDRED, { inStock: false })];
    expect(back(history, priced("s2", HUNDRED, { inStock: false })).alerts).toEqual([]);
  });

  it("does not fire when the listing went out of stock", () => {
    expect(back([priced("s1", HUNDRED)], priced("s2", HUNDRED, { inStock: false })).alerts).toEqual([]);
  });

  it("does not fire on a listing's first snapshot", () => {
    expect(back([], priced("s2", HUNDRED)).alerts).toEqual([]);
  });

  it("fires again after the listing goes in, out and in again", () => {
    const history = [
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.three) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.two), inStock: false }),
    ];
    expect(back(history, priced("s2", HUNDRED)).alerts.map((alert) => alert.kind)).toEqual([AlertKind.BackInStock]);
  });

  it("compares with the newest earlier snapshot, whatever order the history arrives in", () => {
    const history = [
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.two), inStock: false }),
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.three) }),
    ];
    expect(back(history, priced("s2", HUNDRED)).alerts.map((alert) => alert.kind)).toEqual([AlertKind.BackInStock]);
  });

  it("never compares snapshots quoted for different destinations", () => {
    expect(back([priced("s1", HUNDRED, { inStock: false, shipTo: "US" })], priced("s2", HUNDRED)).alerts).toEqual([]);
  });
});

describe("New cheapest alert", () => {
  const known = (amountMinor: number) => ({ kind: ShippingKind.Known, amountMinor, currency: "USD" }) as const;
  const entry = (
    id: string,
    price: number,
    overrides: Partial<PriceSnapshot> = {},
    status: Listing["status"] = ListingStatus.Active,
  ) => {
    const itemPrice = { amountMinor: price, currency: "USD" } as const;
    return withLatest(listing(id, { status }), snapshot(`snap-${id}`, id, { itemPrice, ...overrides }));
  };
  const run = (
    productListings: EvaluateInput["productListings"],
    previousCheapestListingId: EvaluateInput["previousCheapestListingId"],
  ) =>
    evaluate({ ...dropInput(snapshot("in", "a"), [snapshot("old", "a")]), productListings, previousCheapestListingId });

  it("fires when the cheapest listing differs from the previous cheapest", () => {
    const result = run([entry("a", HIGHER), entry("b", HUNDRED)], listingA);
    expect(result.alerts).toEqual([
      {
        kind: AlertKind.NewCheapest,
        productId,
        listingId: listingB,
        beforeSnapshotId: null,
        afterSnapshotId: snapshotIdSchema.parse("snap-b"),
        createdAt: NOW,
      },
    ]);
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("does not fire when the cheapest listing is unchanged", () => {
    const result = run([entry("a", HUNDRED), entry("b", HIGHER)], listingA);
    expect(result.alerts).toEqual([]);
    expect(result.cheapestListingId).toBe(listingA);
  });

  it("does not fire on the first scan, when there is no previous cheapest, but still reports the cheapest", () => {
    const result = run([entry("a", HIGHER), entry("b", HUNDRED)], null);
    expect(result.alerts).toEqual([]);
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("ranks by landed cost, shipping included", () => {
    const result = run([entry("a", HUNDRED, { shipping: known(HUNDRED) }), entry("b", HIGHER)], listingA);
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("converts landed costs to the display currency before ranking", () => {
    const ils = entry("b", DOUBLE, { itemPrice: { amountMinor: DOUBLE, currency: "ILS" } });
    expect(run([entry("a", HUNDRED), ils], listingA).cheapestListingId).toBe(listingB);
  });

  it("excludes listings with unknown shipping", () => {
    const unknownShipping = entry("b", HUNDRED, { shipping: { kind: ShippingKind.Unknown } });
    const result = run([entry("a", HIGHER), unknownShipping], listingA);
    expect(result.cheapestListingId).toBe(listingA);
    expect(result.alerts).toEqual([]);
  });

  it("excludes listings whose landed cost cannot be computed", () => {
    const unrated = entry("b", 1, { itemPrice: { amountMinor: 1, currency: "JPY" } });
    expect(run([entry("a", HIGHER), unrated], listingA).cheapestListingId).toBe(listingA);
  });

  it("excludes stale and gone listings", () => {
    const result = run(
      [entry("a", HIGHER), entry("b", 1, {}, ListingStatus.Stale), entry("c", 1, {}, ListingStatus.Gone)],
      listingA,
    );
    expect(result.cheapestListingId).toBe(listingA);
    expect(result.alerts).toEqual([]);
  });

  it("excludes out-of-stock listings", () => {
    const result = run([entry("a", HIGHER), entry("b", HUNDRED, { inStock: false })], listingA);
    expect(result.cheapestListingId).toBe(listingA);
  });

  it("reports no cheapest and raises nothing when no listing qualifies", () => {
    const result = run(
      [entry("a", HIGHER, { inStock: false }), entry("b", HUNDRED, {}, ListingStatus.Stale)],
      listingA,
    );
    expect(result).toEqual({ alerts: [], cheapestListingId: null });
  });

  it("breaks a landed cost tie by the earlier added listing", () => {
    const early = withLatest(listing("b", { addedAt: daysAgo(AGE.fifty) }), snapshot("snap-b", "b"));
    const late = withLatest(listing("a", { addedAt: daysAgo(AGE.ten) }), snapshot("snap-a", "a"));
    expect(run([late, early], null).cheapestListingId).toBe(listingB);
  });

  it("breaks a tie on landed cost and added time by the lower listing id", () => {
    const first = withLatest(listing("a", { addedAt: daysAgo(AGE.ten) }), snapshot("snap-a", "a"));
    const second = withLatest(listing("b", { addedAt: daysAgo(AGE.ten) }), snapshot("snap-b", "b"));
    expect(run([second, first], null).cheapestListingId).toBe(listingA);
  });

  it("returns no alert for a product whose only listings are stale", () => {
    const result = run([entry("a", HUNDRED, {}, ListingStatus.Stale)], listingA);
    expect(result.alerts).toEqual([]);
  });

  it("returns alerts of several kinds in one evaluation", () => {
    const incoming = priced("s2", SIX_PERCENT);
    const history = [priced("s1", HUNDRED, { inStock: false })];
    const result = evaluate({
      ...dropInput(incoming, history),
      productListings: [withLatest(subject, incoming), entry("b", HIGHER)],
      previousCheapestListingId: listingB,
    });
    expect(result.alerts.map((alert) => alert.kind)).toEqual([
      AlertKind.PriceDrop,
      AlertKind.BackInStock,
      AlertKind.NewCheapest,
    ]);
  });
});
