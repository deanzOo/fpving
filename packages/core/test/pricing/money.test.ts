import { describe, expect, it } from "vitest";
import { roundMinor } from "../../src/pricing/money.ts";

const TIE = 2.5;
const TIE_ROUNDED = 3;
const BELOW_TIE = 2.49;
const BELOW_TIE_ROUNDED = 2;
const WHOLE = 7;

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
