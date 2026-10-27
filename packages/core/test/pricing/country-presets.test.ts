import { describe, expect, it } from "vitest";
import { COUNTRY_PRESETS, presetFor } from "../../src/pricing/country-presets.ts";
import { ThresholdBasis } from "../../src/pricing/import-tax.ts";

const IL_THRESHOLD_USD = 7500;
const IL_VAT_BASIS_POINTS = 1800;

describe("Country presets", () => {
  it("ships Israel with an 18% VAT above a 75 USD duty-free item value", () => {
    expect(COUNTRY_PRESETS.IL.importTax).toEqual({
      dutyFreeThreshold: { amountMinor: IL_THRESHOLD_USD, currency: "USD" },
      vatBasisPoints: IL_VAT_BASIS_POINTS,
      thresholdBasis: ThresholdBasis.Item,
    });
  });

  it("cites the official Israel Tax Authority page the Israeli values came from", () => {
    expect(COUNTRY_PRESETS.IL.source).toEqual({
      url: "https://www.gov.il/he/pages/customs-personal-import-general-info",
      retrievedOn: "2026-10-27",
    });
  });

  it("looks up the preset of a country that has one", () => {
    expect(presetFor("IL")).toBe(COUNTRY_PRESETS.IL);
  });

  it("finds no preset for a country without one", () => {
    expect(presetFor("US")).toBeUndefined();
  });
});
