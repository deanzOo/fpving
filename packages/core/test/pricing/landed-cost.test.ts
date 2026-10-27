import { describe, expect, it } from "vitest";
import { ShippingKind } from "@fpving/plugin-sdk";
import { err, ok } from "../../src/index.ts";
import type { FxTable } from "../../src/pricing/fx.ts";
import { ThresholdBasis } from "../../src/pricing/import-tax.ts";
import { landedCost, landedCostExact } from "../../src/pricing/landed-cost.ts";
import type { PricingSettings } from "../../src/pricing/landed-cost.ts";

const THRESHOLD_USD = 7500;
const VAT_EIGHTEEN_PERCENT = 1800;
const ILS_PER_USD = 3.6;
const EUR_PER_USD = 0.8;
const JPY_PER_USD = 150;
const ONE_CENT = 1;
const THREE_YEN = 3;
const HUGE_ITEM = 5_000_000_000_000_000;
const FULL_VAT = 10_000;
const CHEAP_ITEM = 5000;
const DEAR_ITEM = 10000;
const SHIPPING = 1000;
const FREE_SHIPPING = 0;
const SHIPPING_EUR = 800;
const CHEAP_TOTAL_ILS = 21600;
const DEAR_TOTAL_ILS = 46728;
const CHEAP_TOTAL_USD = 6000;
const CHEAP_FREE_TOTAL_ILS = 18000;
const ITEM_FRACTIONAL = 1001;
const EXACT_ILS = 3603.6;
const ROUNDED_ILS = 3604;

const rates: FxTable = {
  base: "USD",
  ratesPerBase: { ILS: ILS_PER_USD, EUR: EUR_PER_USD, JPY: JPY_PER_USD },
  fetchedOn: "2026-10-27",
};

const settingsIn = (displayCurrency: PricingSettings["displayCurrency"]): PricingSettings => ({
  displayCurrency,
  importTax: {
    dutyFreeThreshold: { amountMinor: THRESHOLD_USD, currency: "USD" },
    vatBasisPoints: VAT_EIGHTEEN_PERCENT,
    thresholdBasis: ThresholdBasis.Item,
  },
});

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" as const });

describe("Landed cost", () => {
  it("adds only shipping when the item is within the duty-free threshold", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Known, ...usd(SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: CHEAP_TOTAL_ILS, currency: "ILS" }));
  });

  it("adds VAT on item plus shipping when the item exceeds the duty-free threshold", () => {
    expect(
      landedCost(
        { itemPrice: usd(DEAR_ITEM), shipping: { kind: ShippingKind.Known, ...usd(SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: DEAR_TOTAL_ILS, currency: "ILS" }));
  });

  it("accepts free shipping", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Known, ...usd(FREE_SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: CHEAP_FREE_TOTAL_ILS, currency: "ILS" }));
  });

  it("converts shipping quoted in another currency before adding it", () => {
    expect(
      landedCost(
        {
          itemPrice: usd(CHEAP_ITEM),
          shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING_EUR, currency: "EUR" },
        },
        settingsIn("USD"),
        rates,
      ),
    ).toEqual(ok(usd(CHEAP_TOTAL_USD)));
  });

  it("refuses to price an item whose shipping is unknown", () => {
    const listing = { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Unknown } };
    expect(landedCost(listing, settingsIn("ILS"), rates)).toEqual(err({ kind: "shipping_unknown" }));
  });

  it("reports a missing rate for the display currency", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Known, ...usd(SHIPPING) } },
        settingsIn("GBP"),
        rates,
      ),
    ).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });

  it("reports a missing rate for the shipping currency", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "GBP" } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });

  it("converts the combined total once, so parts are not rounded separately", () => {
    expect(
      landedCost(
        { itemPrice: usd(ONE_CENT), shipping: { kind: ShippingKind.Known, ...usd(ONE_CENT) } },
        settingsIn("JPY"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: THREE_YEN, currency: "JPY" }));
  });

  it("reports an out-of-range amount when item, shipping and tax together are not a safe integer", () => {
    const fullVat: PricingSettings = {
      ...settingsIn("USD"),
      importTax: { ...settingsIn("USD").importTax, vatBasisPoints: FULL_VAT },
    };
    expect(
      landedCost(
        { itemPrice: usd(HUGE_ITEM), shipping: { kind: ShippingKind.Known, ...usd(FREE_SHIPPING) } },
        fullVat,
        rates,
      ),
    ).toEqual(err({ kind: "amount_out_of_range" }));
  });

  it("reports a missing rate for the threshold currency", () => {
    const gbpThreshold: PricingSettings = {
      ...settingsIn("USD"),
      importTax: { ...settingsIn("USD").importTax, dutyFreeThreshold: { amountMinor: THRESHOLD_USD, currency: "GBP" } },
    };
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: ShippingKind.Known, ...usd(SHIPPING) } },
        gbpThreshold,
        rates,
      ),
    ).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });
});

describe("Exact landed cost", () => {
  const oneUsd = {
    itemPrice: usd(ITEM_FRACTIONAL),
    shipping: { kind: ShippingKind.Known, ...usd(FREE_SHIPPING) },
  } as const;

  it("keeps the fraction of a minor unit that the rounded landed cost drops", () => {
    expect(landedCostExact(oneUsd, settingsIn("ILS"), rates)).toEqual(ok(EXACT_ILS));
    expect(landedCost(oneUsd, settingsIn("ILS"), rates)).toEqual(ok({ amountMinor: ROUNDED_ILS, currency: "ILS" }));
  });

  it("reports unknown shipping", () => {
    const listing = { itemPrice: usd(ITEM_FRACTIONAL), shipping: { kind: ShippingKind.Unknown } } as const;
    expect(landedCostExact(listing, settingsIn("ILS"), rates)).toEqual(err({ kind: "shipping_unknown" }));
  });

  it("reports a display currency without a rate", () => {
    expect(landedCostExact(oneUsd, settingsIn("GBP"), rates)).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });
});
