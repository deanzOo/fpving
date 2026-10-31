import { describe, expect, it } from "vitest";
import { formatMoney } from "../src/money.ts";

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
