import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/index.ts";
import type { FxTable } from "../../src/pricing/fx.ts";
import { importTax, ThresholdBasis } from "../../src/pricing/import-tax.ts";
import type { ImportTaxRule } from "../../src/pricing/import-tax.ts";

const THRESHOLD_USD = 7500;
const VAT_EIGHTEEN_PERCENT = 1800;
const ILS_PER_USD = 3.6;
const AT_THRESHOLD = 7500;
const ABOVE_THRESHOLD = 7501;
const SHIPPING = 1000;
const BELOW_ITEM_SHARE = 6500;
const ABOVE_ITEM_SHARE = 6501;
const SPLIT_ITEM = 5000;
const SPLIT_SHIPPING = 5000;
const TAX_ON_ABOVE_ITEM_PLUS_SHIPPING = 1530;
const TAX_ON_SPLIT = 1800;
const TAX_ON_ABOVE_COMBINED = 1350;
const NO_TAX = 0;
const NO_SHIPPING = 0;
const ILS_AT_THRESHOLD = 27000;
const ILS_ABOVE_THRESHOLD = 27002;
const SHIPPING_USD_IN_ILS_TAX = 5508;
const TIE_ITEM = 7525;
const TIE_TAX = 1355;

const rates: FxTable = { base: "USD", ratesPerBase: { ILS: ILS_PER_USD }, fetchedOn: "2026-10-27" };

const ruleWith = (thresholdBasis: ImportTaxRule["thresholdBasis"]): ImportTaxRule => ({
  dutyFreeThreshold: { amountMinor: THRESHOLD_USD, currency: "USD" },
  vatBasisPoints: VAT_EIGHTEEN_PERCENT,
  thresholdBasis,
});

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" as const });
const ils = (amountMinor: number) => ({ amountMinor, currency: "ILS" as const });

describe("Import tax", () => {
  it("charges no tax when the item is exactly at the duty-free threshold", () => {
    expect(importTax(usd(AT_THRESHOLD), usd(SHIPPING), ruleWith(ThresholdBasis.Item), rates)).toEqual(
      ok(usd(NO_TAX)),
    );
  });

  it("charges VAT on item plus shipping once the item is above the threshold", () => {
    expect(importTax(usd(ABOVE_THRESHOLD), usd(SHIPPING), ruleWith(ThresholdBasis.Item), rates)).toEqual(
      ok(usd(TAX_ON_ABOVE_ITEM_PLUS_SHIPPING)),
    );
  });

  it("ignores shipping when the threshold applies to the item only", () => {
    expect(importTax(usd(SPLIT_ITEM), usd(SPLIT_SHIPPING), ruleWith(ThresholdBasis.Item), rates)).toEqual(
      ok(usd(NO_TAX)),
    );
  });

  it("counts shipping toward the threshold when it applies to item plus shipping", () => {
    expect(
      importTax(usd(SPLIT_ITEM), usd(SPLIT_SHIPPING), ruleWith(ThresholdBasis.ItemAndShipping), rates),
    ).toEqual(ok(usd(TAX_ON_SPLIT)));
  });

  it("charges no tax when item plus shipping is exactly at the threshold", () => {
    expect(
      importTax(usd(BELOW_ITEM_SHARE), usd(SHIPPING), ruleWith(ThresholdBasis.ItemAndShipping), rates),
    ).toEqual(ok(usd(NO_TAX)));
  });

  it("charges tax when item plus shipping is one minor unit above the threshold", () => {
    expect(
      importTax(usd(ABOVE_ITEM_SHARE), usd(SHIPPING), ruleWith(ThresholdBasis.ItemAndShipping), rates),
    ).toEqual(ok(usd(TAX_ON_ABOVE_COMBINED)));
  });

  it("compares in the threshold currency and returns tax in the item currency", () => {
    const rule = ruleWith(ThresholdBasis.Item);
    expect(importTax(ils(ILS_AT_THRESHOLD), usd(SHIPPING), rule, rates)).toEqual(ok(ils(NO_TAX)));
    expect(importTax(ils(ILS_ABOVE_THRESHOLD), usd(SHIPPING), rule, rates)).toEqual(
      ok(ils(SHIPPING_USD_IN_ILS_TAX)),
    );
  });

  it("rounds the VAT half-up to a minor unit", () => {
    expect(importTax(usd(TIE_ITEM), usd(NO_SHIPPING), ruleWith(ThresholdBasis.Item), rates)).toEqual(
      ok(usd(TIE_TAX)),
    );
  });

  it("reports a missing rate instead of guessing", () => {
    const gbp = { amountMinor: AT_THRESHOLD, currency: "GBP" as const };
    expect(importTax(gbp, usd(SHIPPING), ruleWith(ThresholdBasis.Item), rates)).toEqual(
      err({ kind: "missing_rate", currency: "GBP" }),
    );
  });

  it("reports a missing rate for the shipping currency", () => {
    const gbp = { amountMinor: SHIPPING, currency: "GBP" as const };
    expect(importTax(usd(AT_THRESHOLD), gbp, ruleWith(ThresholdBasis.Item), rates)).toEqual(
      err({ kind: "missing_rate", currency: "GBP" }),
    );
  });
});
