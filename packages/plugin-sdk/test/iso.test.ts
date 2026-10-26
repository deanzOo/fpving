import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, CURRENCY_CODES, countryCodeSchema, currencyCodeSchema } from "../src/iso.ts";

const CIRCULATING_CURRENCY_COUNT = 155;
const ASSIGNED_COUNTRY_COUNT = 249;

describe("ISO 4217 currency codes", () => {
  it("lists every circulating currency of ISO 4217 list one exactly once", () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CIRCULATING_CURRENCY_COUNT);
    expect(CURRENCY_CODES).toContain("USD");
    expect(CURRENCY_CODES).toContain("ILS");
  });

  it("excludes funds, precious metals and testing codes", () => {
    for (const code of ["XAU", "XTS", "XXX", "XDR", "BOV", "USN"]) {
      expect(currencyCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it("rejects lowercase and unknown codes", () => {
    expect(currencyCodeSchema.safeParse("usd").success).toBe(false);
    expect(currencyCodeSchema.safeParse("ABC").success).toBe(false);
  });

  it("accepts a listed code", () => {
    expect(currencyCodeSchema.parse("EUR")).toBe("EUR");
  });
});

describe("ISO 3166-1 alpha-2 country codes", () => {
  it("lists every officially assigned country code exactly once", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(ASSIGNED_COUNTRY_COUNT);
    expect(COUNTRY_CODES).toContain("IL");
  });

  it("rejects lowercase, alpha-3 and unassigned codes", () => {
    for (const code of ["il", "ISR", "UK", "XK"]) {
      expect(countryCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it("accepts an assigned code", () => {
    expect(countryCodeSchema.parse("GB")).toBe("GB");
  });
});
