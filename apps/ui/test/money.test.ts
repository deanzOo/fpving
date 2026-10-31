import { describe, expect, it } from "vitest";
import { formatMoney, fromDecimal, toDecimal } from "../src/money.ts";

const LOCALE = "en-US";
const MINOR = 1999;
const FIVE_CENTS = 5;

describe("Money display", () => {
  it.each([
    ["USD", MINOR, "$19.99"],
    ["JPY", MINOR, "¥1,999"],
    ["KWD", MINOR, "KWD\u00A01.999"],
    ["USD", FIVE_CENTS, "$0.05"],
  ] as const)("formats %s %d minor units with the currency's own decimals", (currency, amountMinor, shown) => {
    expect(formatMoney({ amountMinor, currency }, LOCALE)).toBe(shown);
  });

  it("formats the largest safe amount exactly, without a float round trip", () => {
    const largest = { amountMinor: Number.MAX_SAFE_INTEGER, currency: "USD" } as const;
    expect(formatMoney(largest, LOCALE)).toBe("$90,071,992,547,409.91");
  });
});

describe("Decimal amounts", () => {
  const CENTS = 2;
  const MILLS = 3;
  const NINETEEN_NINETY = 1990;
  const NINETEEN = 1900;

  it.each([
    ["19.99", CENTS, MINOR],
    ["19.9", CENTS, NINETEEN_NINETY],
    ["19", CENTS, NINETEEN],
    ["0.05", CENTS, FIVE_CENTS],
    ["1999", 0, MINOR],
    ["1.999", MILLS, MINOR],
  ] as const)("reads %s with %d decimals as %d minor units", (text, decimals, minor) => {
    expect(fromDecimal(text, decimals)).toBe(minor);
  });

  it.each([["19.999", CENTS], ["19.5", 0], ["", CENTS], ["-1", CENTS], ["1e3", CENTS], ["1.", CENTS], [" 1", CENTS]])(
    "refuses %j with %d decimals", (text, decimals) => {
      expect(fromDecimal(text, decimals)).toBeNaN();
    },
  );

  it("writes minor units back as the same decimal", () => {
    expect(toDecimal(FIVE_CENTS, CENTS)).toBe("0.05");
    expect(toDecimal(MINOR, 0)).toBe("1999");
  });
});
