import { describe, expect, it } from "vitest";
import { amountSchema, moneySchema } from "../src/money.ts";

const PRICE = 1999;
const NEGATIVE = -100;
const FRACTIONAL = 19.99;

describe("money", () => {
  it("accepts a positive integer amount in minor units with a known currency", () => {
    expect(moneySchema.parse({ amountMinor: PRICE, currency: "USD" })).toEqual({ amountMinor: PRICE, currency: "USD" });
  });

  it.each([
    ["zero, a store placeholder price", 0],
    ["a negative amount", NEGATIVE],
    ["a fractional amount", FRACTIONAL],
    ["an amount beyond the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s", (_name, amountMinor) => {
    expect(moneySchema.safeParse({ amountMinor, currency: "USD" }).success).toBe(false);
  });

  it("rejects an unknown currency", () => {
    expect(moneySchema.safeParse({ amountMinor: PRICE, currency: "ABC" }).success).toBe(false);
  });
});

describe("amount", () => {
  it("accepts zero because free shipping and exempt tax are real amounts", () => {
    expect(amountSchema.parse({ amountMinor: 0, currency: "EUR" })).toEqual({ amountMinor: 0, currency: "EUR" });
  });

  it.each([
    ["a negative amount", NEGATIVE],
    ["a fractional amount", FRACTIONAL],
    ["an amount beyond the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s", (_name, amountMinor) => {
    expect(amountSchema.safeParse({ amountMinor, currency: "EUR" }).success).toBe(false);
  });
});
