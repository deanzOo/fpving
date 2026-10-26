import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/index.ts";
import type { FxTable } from "../../src/pricing/fx.ts";
import { ThresholdBasis } from "../../src/pricing/import-tax.ts";
import { landedCost } from "../../src/pricing/landed-cost.ts";
import type { PricingSettings } from "../../src/pricing/landed-cost.ts";

const THRESHOLD_USD = 7500;
const VAT_EIGHTEEN_PERCENT = 1800;
const ILS_PER_USD = 3.6;
const EUR_PER_USD = 0.8;
const CHEAP_ITEM = 5000;
const DEAR_ITEM = 10000;
const SHIPPING = 1000;
const FREE_SHIPPING = 0;
const SHIPPING_EUR = 800;
const CHEAP_TOTAL_ILS = 21600;
const DEAR_TOTAL_ILS = 46728;
const CHEAP_TOTAL_USD = 6000;
const CHEAP_FREE_TOTAL_ILS = 18000;

const rates: FxTable = {
  base: "USD",
  ratesPerBase: { ILS: ILS_PER_USD, EUR: EUR_PER_USD },
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
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: "known", ...usd(SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: CHEAP_TOTAL_ILS, currency: "ILS" }));
  });

  it("adds VAT on item plus shipping when the item exceeds the duty-free threshold", () => {
    expect(
      landedCost(
        { itemPrice: usd(DEAR_ITEM), shipping: { kind: "known", ...usd(SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: DEAR_TOTAL_ILS, currency: "ILS" }));
  });

  it("accepts free shipping", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: "known", ...usd(FREE_SHIPPING) } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(ok({ amountMinor: CHEAP_FREE_TOTAL_ILS, currency: "ILS" }));
  });

  it("converts shipping quoted in another currency before adding it", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: "known", amountMinor: SHIPPING_EUR, currency: "EUR" } },
        settingsIn("USD"),
        rates,
      ),
    ).toEqual(ok(usd(CHEAP_TOTAL_USD)));
  });

  it("refuses to price an item whose shipping is unknown", () => {
    expect(landedCost({ itemPrice: usd(CHEAP_ITEM), shipping: { kind: "unknown" } }, settingsIn("ILS"), rates)).toEqual(
      err({ kind: "shipping_unknown" }),
    );
  });

  it("reports a missing rate for the display currency", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: "known", ...usd(SHIPPING) } },
        settingsIn("GBP"),
        rates,
      ),
    ).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });

  it("reports a missing rate for the shipping currency", () => {
    expect(
      landedCost(
        { itemPrice: usd(CHEAP_ITEM), shipping: { kind: "known", amountMinor: SHIPPING, currency: "GBP" } },
        settingsIn("ILS"),
        rates,
      ),
    ).toEqual(err({ kind: "missing_rate", currency: "GBP" }));
  });
});
