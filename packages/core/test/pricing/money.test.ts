import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/index.ts";
import { roundMinor, toAmount } from "../../src/pricing/money.ts";

const TIE = 2.5;
const TIE_ROUNDED = 3;
const BELOW_TIE = 2.49;
const BELOW_TIE_ROUNDED = 2;
const WHOLE = 7;
const UNSAFE = Number.MAX_SAFE_INTEGER + 1;
const FRACTION = 1.5;

describe("Rounding to minor units", () => {
  it("rounds a half up to the next minor unit", () => {
    expect(roundMinor(TIE)).toBe(TIE_ROUNDED);
  });

  it("rounds below a half down", () => {
    expect(roundMinor(BELOW_TIE)).toBe(BELOW_TIE_ROUNDED);
  });

  it("leaves whole amounts unchanged", () => {
    expect(roundMinor(WHOLE)).toBe(WHOLE);
  });
});

describe("Computed amounts", () => {
  it("wraps a safe integer, zero included, as an amount in the currency", () => {
    expect(toAmount(WHOLE, "USD")).toEqual(ok({ amountMinor: WHOLE, currency: "USD" }));
    expect(toAmount(0, "USD")).toEqual(ok({ amountMinor: 0, currency: "USD" }));
  });

  it.each([
    ["beyond the safe integer range", UNSAFE],
    ["not finite", Number.POSITIVE_INFINITY],
    ["not a whole number", FRACTION],
  ])("reports an amount that is %s as out of range", (_name, amountMinor) => {
    expect(toAmount(amountMinor, "USD")).toEqual(err({ kind: "amount_out_of_range" }));
  });
});
