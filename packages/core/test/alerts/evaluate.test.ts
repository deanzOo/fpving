import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { AlertKind, ListingStatus, listingIdSchema, productIdSchema, snapshotIdSchema } from "../../src/index.ts";
import type { Listing, PriceSnapshot } from "../../src/index.ts";
import { evaluate } from "../../src/alerts/evaluate.ts";
import type { EvaluateInput } from "../../src/alerts/evaluate.ts";
import { NOW, daysAgo, listing, rates, settings, snapshot, withLatest } from "./builders.ts";

const HUNDRED = 10_000;
const EXACTLY_FIVE_PERCENT = 9500;
const JUST_UNDER_FIVE_PERCENT = 9501;
const SIX_PERCENT = 9400;
const TWO_PERCENT = 9800;
const AGE = {
  one: 1,
  two: 2,
  three: 3,
  five: 5,
  ten: 10,
  twenty: 20,
  thirty: 30,
  thirtyOne: 31,
  forty: 40,
  fifty: 50,
  twoHundred: 200,
};
const DOUBLE = 20_000;
const ILS_TIE_PRICE = 3601;
const USD_TIE_PRICE = 1000;
const SHIPPING_COST = 5000;
const OUT_OF_STOCK_LOW = 5000;
const IN_STOCK_MID = 8000;
const IN_STOCK_LOW = 7000;
const CHEAP_ILS_PER_USD = 2;
const HIGHER = 11_000;
const LOWER = 9000;

const subject = listing("a");
const productId = productIdSchema.parse("p1");
const listingA = listingIdSchema.parse("a");
const listingB = listingIdSchema.parse("b");

const priced = (id: string, amountMinor: number, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot =>
  snapshot(id, "a", { itemPrice: { amountMinor, currency: "USD" }, observedAt: daysAgo(AGE.two), ...overrides });

const arriving = (id: string, amountMinor: number, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot =>
  priced(id, amountMinor, { observedAt: daysAgo(AGE.one), ...overrides });

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

  it("fires when the item price is a new 30-day low at least the default 5% threshold below the previous low", () => {
    const history = [
      priced("s0", HIGHER, { observedAt: daysAgo(AGE.ten) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.five) }),
    ];
    const incoming = arriving("s2", SIX_PERCENT);
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

  it("fires when the drop is exactly the default 5% threshold below the previous low", () => {
    const input = dropInput(arriving("s2", EXACTLY_FIVE_PERCENT), [priced("s1", HUNDRED)]);
    expect(kinds(input)).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire when the drop is just under the default 5% threshold below the previous low", () => {
    expect(kinds(dropInput(arriving("s2", JUST_UNDER_FIVE_PERCENT), [priced("s1", HUNDRED)]))).toEqual([]);
  });

  it("does not fire when the new low is less than the default 5% threshold below the previous low", () => {
    expect(kinds(dropInput(arriving("s2", TWO_PERCENT), [priced("s1", HUNDRED)]))).toEqual([]);
  });

  it("does not fire when the incoming price is not the lowest in the window", () => {
    const history = [
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.twenty) }),
      priced("s1", SIX_PERCENT, { observedAt: daysAgo(AGE.ten) }),
    ];
    expect(kinds(dropInput(arriving("s2", EXACTLY_FIVE_PERCENT), history))).toEqual([]);
  });

  describe("Comparing against the lowest price in the window", () => {
    const older = priced("s0", HIGHER, { observedAt: daysAgo(AGE.twenty) });
    const lowest = priced("s1", HUNDRED, { observedAt: daysAgo(AGE.ten) });

    it.each([
      ["oldest first", [older, lowest]],
      ["newest first", [lowest, older]],
    ])("picks the lowest snapshot when the history arrives %s", (_order, history) => {
      const result = evaluate(dropInput(arriving("s2", SIX_PERCENT), history));
      expect(result.alerts.map((alert) => alert.beforeSnapshotId)).toEqual([snapshotIdSchema.parse("s1")]);
    });
  });

  it("ignores a lower price older than 30 days", () => {
    const history = [
      priced("s0", LOWER, { observedAt: daysAgo(AGE.thirtyOne) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.five) }),
    ];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([AlertKind.PriceDrop]);
  });

  it("counts a snapshot observed exactly 30 days ago", () => {
    const history = [priced("s0", HUNDRED, { observedAt: daysAgo(AGE.thirty) })];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire when the window holds no earlier snapshot", () => {
    const history = [priced("s0", HUNDRED, { observedAt: daysAgo(AGE.forty) })];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("never compares snapshots quoted for different destinations", () => {
    const history = [priced("s0", HUNDRED, { shipTo: "US" })];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("ignores earlier prices quoted in another currency", () => {
    const history = [priced("s0", HUNDRED, { itemPrice: { amountMinor: HUNDRED, currency: "ILS" } })];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([]);
  });

  it("raises nothing when only the exchange rates change between two equal native prices", () => {
    const ils = { amountMinor: HUNDRED, currency: "ILS" } as const;
    const input = dropInput(arriving("s2", HUNDRED, { itemPrice: ils }), [priced("s1", HUNDRED, { itemPrice: ils })]);
    const cheaperIls = { ...rates, ratesPerBase: { ILS: CHEAP_ILS_PER_USD } };
    expect(kinds(input)).toEqual([]);
    expect(kinds({ ...input, rates: cheaperIls })).toEqual([]);
  });

  it("does not fire when only shipping got cheaper and the item price is equal", () => {
    const dearShipping = { kind: ShippingKind.Known, amountMinor: SHIPPING_COST, currency: "USD" } as const;
    const history = [priced("s0", HUNDRED, { shipping: dearShipping })];
    expect(kinds(dropInput(arriving("s2", HUNDRED), history))).toEqual([]);
  });

  it("fires on the item price drop even when shipping got dearer", () => {
    const dearShipping = { kind: ShippingKind.Known, amountMinor: SHIPPING_COST, currency: "USD" } as const;
    const incoming = arriving("s2", SIX_PERCENT, { shipping: dearShipping });
    expect(kinds(dropInput(incoming, [priced("s0", HUNDRED)]))).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire when the incoming snapshot is out of stock, however low its price", () => {
    const incoming = arriving("s2", SIX_PERCENT, { inStock: false });
    expect(kinds(dropInput(incoming, [priced("s1", HUNDRED)]))).toEqual([]);
  });

  it("leaves out-of-stock snapshots out of the previous low", () => {
    const history = [
      priced("s0", OUT_OF_STOCK_LOW, { observedAt: daysAgo(AGE.twenty), inStock: false }),
      priced("s1", IN_STOCK_MID, { observedAt: daysAgo(AGE.ten) }),
    ];
    const result = evaluate(dropInput(arriving("s2", IN_STOCK_LOW), history));
    expect(result.alerts.map((alert) => [alert.kind, alert.beforeSnapshotId])).toEqual([
      [AlertKind.PriceDrop, snapshotIdSchema.parse("s1")],
    ]);
  });

  it("does not fire when every earlier snapshot in the window was out of stock", () => {
    const history = [priced("s0", HUNDRED, { inStock: false })];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).not.toContain(AlertKind.PriceDrop);
  });

  it("still fires when the history already contains the incoming snapshot", () => {
    const incoming = arriving("s2", SIX_PERCENT);
    expect(kinds(dropInput(incoming, [priced("s1", HUNDRED), incoming]))).toEqual([AlertKind.PriceDrop]);
  });

  it("ignores snapshots observed after the incoming one", () => {
    const history = [
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.five) }),
      priced("s3", OUT_OF_STOCK_LOW, { observedAt: NOW }),
    ];
    expect(kinds(dropInput(arriving("s2", SIX_PERCENT), history))).toEqual([AlertKind.PriceDrop]);
  });

  it("fires on any strict new low when the threshold is zero", () => {
    const input = {
      ...dropInput(arriving("s2", HUNDRED - 1), [priced("s1", HUNDRED)]),
      settings: { ...settings, priceDropMinBasisPoints: 0 },
    };
    expect(kinds(input)).toEqual([AlertKind.PriceDrop]);
  });

  it("does not fire on an equal price when the threshold is zero", () => {
    const input = {
      ...dropInput(arriving("s2", HUNDRED), [priced("s1", HUNDRED)]),
      settings: { ...settings, priceDropMinBasisPoints: 0 },
    };
    expect(kinds(input)).toEqual([]);
  });
});

describe("Back in stock alert", () => {
  const back = (history: PriceSnapshot[], incoming: PriceSnapshot) => evaluate(dropInput(incoming, history));

  it("fires when the previous snapshot was out of stock and the incoming one is in stock", () => {
    const result = back([priced("s1", HUNDRED, { inStock: false })], arriving("s2", HUNDRED));
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
    expect(back([priced("s1", HUNDRED)], arriving("s2", HUNDRED)).alerts).toEqual([]);
  });

  it("does not fire when the listing stayed out of stock", () => {
    const history = [priced("s1", HUNDRED, { inStock: false })];
    expect(back(history, arriving("s2", HUNDRED, { inStock: false })).alerts).toEqual([]);
  });

  it("does not fire when the listing went out of stock", () => {
    expect(back([priced("s1", HUNDRED)], arriving("s2", HUNDRED, { inStock: false })).alerts).toEqual([]);
  });

  it("does not fire on a listing's first snapshot", () => {
    expect(back([], arriving("s2", HUNDRED)).alerts).toEqual([]);
  });

  it("fires again after the listing goes in, out and in again", () => {
    const history = [
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.three) }),
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.two), inStock: false }),
    ];
    expect(back(history, arriving("s2", HUNDRED)).alerts.map((alert) => alert.kind)).toEqual([AlertKind.BackInStock]);
  });

  it("compares with the newest earlier snapshot, whatever order the history arrives in", () => {
    const history = [
      priced("s1", HUNDRED, { observedAt: daysAgo(AGE.two), inStock: false }),
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.three) }),
    ];
    expect(back(history, arriving("s2", HUNDRED)).alerts.map((alert) => alert.kind)).toEqual([AlertKind.BackInStock]);
  });

  it("still fires when the history already contains the incoming snapshot", () => {
    const incoming = arriving("s2", HUNDRED);
    const history = [priced("s1", HUNDRED, { inStock: false }), incoming];
    expect(back(history, incoming).alerts.map((alert) => alert.kind)).toEqual([AlertKind.BackInStock]);
  });

  it("ignores snapshots observed after the incoming one", () => {
    const history = [priced("s1", HUNDRED), priced("s3", HUNDRED, { observedAt: NOW, inStock: false })];
    expect(back(history, arriving("s2", HUNDRED)).alerts).toEqual([]);
  });

  it("never compares snapshots quoted for different destinations", () => {
    expect(back([priced("s1", HUNDRED, { inStock: false, shipTo: "US" })], arriving("s2", HUNDRED)).alerts).toEqual([]);
  });
});

describe("New cheapest alert", () => {
  const known = (amountMinor: number) => ({ kind: ShippingKind.Known, amountMinor, currency: "USD" }) as const;
  const entry = (
    id: string,
    price: number,
    overrides: Partial<PriceSnapshot> = {},
    status: Listing["status"] = ListingStatus.Active,
    addedAt = listing(id).addedAt,
  ) => {
    const itemPrice = { amountMinor: price, currency: "USD" } as const;
    return withLatest(listing(id, { status, addedAt }), snapshot(`snap-${id}`, id, { itemPrice, ...overrides }));
  };
  const run = (
    others: EvaluateInput["productListings"],
    previousCheapestListingId: EvaluateInput["previousCheapestListingId"],
    incoming = arriving("in", HIGHER),
  ) => evaluate({ ...dropInput(incoming, []), productListings: others, previousCheapestListingId });

  it("fires when the cheapest listing differs from the previous cheapest", () => {
    const result = run([entry("b", HUNDRED)], listingA);
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

  it("counts the incoming snapshot as the listing's latest, replacing its entry in the product's listings", () => {
    const result = run([entry("a", LOWER), entry("b", HUNDRED)], listingA, arriving("in", HIGHER));
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("does not choose the listing itself on an old cheap snapshot when the incoming one is out of stock", () => {
    const incoming = arriving("in", HIGHER, { inStock: false });
    const result = run([entry("a", LOWER), entry("b", HIGHER)], listingB, incoming);
    expect(result.cheapestListingId).toBe(listingB);
    expect(result.alerts).toEqual([]);
  });

  it("does not fire when the cheapest listing is unchanged", () => {
    const result = run([entry("b", HIGHER)], listingA, arriving("in", HUNDRED));
    expect(result.alerts).toEqual([]);
    expect(result.cheapestListingId).toBe(listingA);
  });

  it("does not fire on the first scan, when there is no previous cheapest, but still reports the cheapest", () => {
    const result = run([entry("b", HUNDRED)], null);
    expect(result.alerts).toEqual([]);
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("leaves out a latest snapshot quoted for another destination, as after a destination switch", () => {
    const result = run([entry("b", HUNDRED, { shipTo: "US" })], listingA);
    expect(result.alerts).toEqual([]);
    expect(result.cheapestListingId).toBe(listingA);
  });

  it("ranks by landed cost, shipping included", () => {
    const result = run([entry("b", HIGHER)], listingA, arriving("in", HUNDRED, { shipping: known(HUNDRED) }));
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("converts landed costs to the display currency before ranking", () => {
    const ils = entry("b", DOUBLE, { itemPrice: { amountMinor: DOUBLE, currency: "ILS" } });
    expect(run([ils], listingA, arriving("in", HUNDRED)).cheapestListingId).toBe(listingB);
  });

  it("ranks on exact converted costs, so costs that round to the same amount are not treated as a tie", () => {
    const itemPrice = { amountMinor: ILS_TIE_PRICE, currency: "ILS" } as const;
    const ils = entry("b", ILS_TIE_PRICE, { itemPrice }, ListingStatus.Active, daysAgo(AGE.twoHundred));
    expect(run([ils], listingB, arriving("in", USD_TIE_PRICE)).cheapestListingId).toBe(listingA);
  });

  it("excludes listings with unknown shipping", () => {
    const unknownShipping = entry("b", HUNDRED, { shipping: { kind: ShippingKind.Unknown } });
    const result = run([unknownShipping], listingA);
    expect(result.cheapestListingId).toBe(listingA);
    expect(result.alerts).toEqual([]);
  });

  it("excludes listings whose landed cost cannot be computed", () => {
    const unrated = entry("b", 1, { itemPrice: { amountMinor: 1, currency: "JPY" } });
    expect(run([unrated], listingA).cheapestListingId).toBe(listingA);
  });

  it("compares nothing and keeps the previous cheapest when no exchange rates were ever fetched", () => {
    const input = { ...dropInput(arriving("in", HUNDRED), []), previousCheapestListingId: listingB, rates: null };
    expect(evaluate(input)).toEqual({ alerts: [], cheapestListingId: listingB });
  });

  it("excludes stale and gone listings", () => {
    const result = run([entry("b", 1, {}, ListingStatus.Stale), entry("c", 1, {}, ListingStatus.Gone)], listingA);
    expect(result.cheapestListingId).toBe(listingA);
    expect(result.alerts).toEqual([]);
  });

  it("excludes out-of-stock listings", () => {
    const result = run([entry("b", HUNDRED, { inStock: false })], listingA);
    expect(result.cheapestListingId).toBe(listingA);
  });

  it("keeps the previous cheapest and raises nothing when no listing qualifies", () => {
    const incoming = arriving("in", HIGHER, { inStock: false });
    const result = run([entry("b", HUNDRED, {}, ListingStatus.Stale)], listingB, incoming);
    expect(result).toEqual({ alerts: [], cheapestListingId: listingB });
  });

  it("clears a previous cheapest that is gone when no listing qualifies, raising nothing", () => {
    const incoming = arriving("in", HIGHER, { inStock: false });
    const result = run([entry("b", HUNDRED, {}, ListingStatus.Gone)], listingB, incoming);
    expect(result).toEqual({ alerts: [], cheapestListingId: null });
  });

  it("clears a previous cheapest that is gone even without exchange rates", () => {
    const productListings = [entry("b", HUNDRED, {}, ListingStatus.Gone)];
    const input = { ...dropInput(arriving("in", HUNDRED), []), productListings, previousCheapestListingId: listingB };
    expect(evaluate({ ...input, rates: null })).toEqual({ alerts: [], cheapestListingId: null });
  });

  it("reports no cheapest only when none was ever computed", () => {
    const incoming = arriving("in", HIGHER, { inStock: false });
    expect(run([], null, incoming)).toEqual({ alerts: [], cheapestListingId: null });
  });

  it("fires when a listing qualifies after none did", () => {
    const incoming = arriving("in", HIGHER, { inStock: false });
    const result = run([entry("b", HUNDRED)], listingA, incoming);
    expect(result.alerts.map((alert) => alert.kind)).toEqual([AlertKind.NewCheapest]);
    expect(result.cheapestListingId).toBe(listingB);
  });

  it("breaks a landed cost tie by the earlier added listing", () => {
    const early = entry("b", HUNDRED, {}, ListingStatus.Active, daysAgo(AGE.twoHundred));
    expect(run([early], null, arriving("in", HUNDRED)).cheapestListingId).toBe(listingB);
  });

  it("breaks a tie on landed cost and added time by the lower listing id", () => {
    expect(run([entry("b", HUNDRED)], null, arriving("in", HUNDRED)).cheapestListingId).toBe(listingA);
  });

  it("compares listing ids by code point, not by locale", () => {
    const upper = listingIdSchema.parse("B");
    expect(run([entry("B", HUNDRED)], null, arriving("in", HUNDRED)).cheapestListingId).toBe(upper);
  });

  it("returns alerts of several kinds in one evaluation", () => {
    const incoming = arriving("s2", SIX_PERCENT);
    const history = [
      priced("s0", HUNDRED, { observedAt: daysAgo(AGE.three) }),
      priced("s1", HUNDRED, { inStock: false }),
    ];
    const result = evaluate({
      ...dropInput(incoming, history),
      productListings: [entry("b", HIGHER)],
      previousCheapestListingId: listingB,
    });
    expect(result.alerts.map((alert) => alert.kind)).toEqual([
      AlertKind.PriceDrop,
      AlertKind.BackInStock,
      AlertKind.NewCheapest,
    ]);
  });
});
