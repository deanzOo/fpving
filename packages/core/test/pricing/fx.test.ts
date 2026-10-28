import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/index.ts";
import { convert, fxTableSchema } from "../../src/pricing/fx.ts";
import type { FxTable } from "../../src/pricing/fx.ts";

const ILS_PER_USD = 3.6;
const EUR_PER_USD = 0.8;
const JPY_PER_USD = 150;
const KWD_PER_USD = 0.3;
const TEN_USD = 1000;
const THIRTY_SIX_ILS = 3600;
const EIGHTY_EUR = 8000;
const THREE_HUNDRED_SIXTY_ILS = 36000;
const FIFTEEN_HUNDRED_JPY = 1500;
const THREE_KWD = 3000;
const ONE_US_CENT = 1;
const TWO_JPY = 2;
const ONE_JPY = 1;
const USD_PER_JPY = 0.003;
const ZERO_USD = 0;
const BAD_RATES = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const LARGEST_AMOUNT = Number.MAX_SAFE_INTEGER;

const rates: FxTable = {
  base: "USD",
  ratesPerBase: { ILS: ILS_PER_USD, EUR: EUR_PER_USD, JPY: JPY_PER_USD, KWD: KWD_PER_USD },
  fetchedOn: "2026-10-27",
};

describe("Currency conversion", () => {
  it("converts from the base currency to another currency", () => {
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "ILS", rates)).toEqual(
      ok({ amountMinor: THIRTY_SIX_ILS, currency: "ILS" }),
    );
  });

  it("converts back to the base currency", () => {
    expect(convert({ amountMinor: THIRTY_SIX_ILS, currency: "ILS" }, "USD", rates)).toEqual(
      ok({ amountMinor: TEN_USD, currency: "USD" }),
    );
  });

  it("converts between two currencies when neither is the base", () => {
    expect(convert({ amountMinor: EIGHTY_EUR, currency: "EUR" }, "ILS", rates)).toEqual(
      ok({ amountMinor: THREE_HUNDRED_SIXTY_ILS, currency: "ILS" }),
    );
  });

  it("handles a currency with no minor units", () => {
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "JPY", rates)).toEqual(
      ok({ amountMinor: FIFTEEN_HUNDRED_JPY, currency: "JPY" }),
    );
    expect(convert({ amountMinor: FIFTEEN_HUNDRED_JPY, currency: "JPY" }, "USD", rates)).toEqual(
      ok({ amountMinor: TEN_USD, currency: "USD" }),
    );
  });

  it("handles a currency with three minor-unit digits", () => {
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "KWD", rates)).toEqual(
      ok({ amountMinor: THREE_KWD, currency: "KWD" }),
    );
  });

  it("rounds a converted half minor unit up", () => {
    expect(convert({ amountMinor: ONE_US_CENT, currency: "USD" }, "JPY", rates)).toEqual(
      ok({ amountMinor: TWO_JPY, currency: "JPY" }),
    );
  });

  it("returns the same amount without a rate when the currency does not change", () => {
    const empty: FxTable = { base: "USD", ratesPerBase: {}, fetchedOn: "2026-10-27" };
    expect(convert({ amountMinor: TEN_USD, currency: "EUR" }, "EUR", empty)).toEqual(
      ok({ amountMinor: TEN_USD, currency: "EUR" }),
    );
  });

  it("reports the target currency when its rate is missing", () => {
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "GBP", rates)).toEqual(
      err({ kind: "missing_rate", currency: "GBP" }),
    );
  });

  it("reports the source currency when its rate is missing", () => {
    expect(convert({ amountMinor: TEN_USD, currency: "GBP" }, "USD", rates)).toEqual(
      err({ kind: "missing_rate", currency: "GBP" }),
    );
  });

  it.each(BAD_RATES)("treats the rate %s as missing", (rate) => {
    const broken: FxTable = { ...rates, ratesPerBase: { ILS: rate } };
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "ILS", broken)).toEqual(
      err({ kind: "missing_rate", currency: "ILS" }),
    );
  });

  it("returns zero rather than an error when an amount converts to less than half a minor unit", () => {
    const yenBase: FxTable = { base: "JPY", ratesPerBase: { USD: USD_PER_JPY }, fetchedOn: "2026-10-27" };
    expect(convert({ amountMinor: ONE_JPY, currency: "JPY" }, "USD", yenBase)).toEqual(
      ok({ amountMinor: ZERO_USD, currency: "USD" }),
    );
  });

  it("reports an out-of-range amount when the converted value is not a safe integer", () => {
    expect(convert({ amountMinor: LARGEST_AMOUNT, currency: "USD" }, "JPY", rates)).toEqual(
      err({ kind: "amount_out_of_range" }),
    );
  });
});

describe("Exchange rate table", () => {
  it("accepts a table of positive finite rates published on an ISO date", () => {
    expect(fxTableSchema.parse(rates)).toEqual(rates);
  });

  it.each(BAD_RATES)("rejects the rate %s", (rate) => {
    expect(fxTableSchema.safeParse({ ...rates, ratesPerBase: { ILS: rate } }).success).toBe(false);
  });

  it.each(["2026-13-01", "27/10/2026", "2026-10-27T00:00:00Z", ""])("rejects the publication date %j", (fetchedOn) => {
    expect(fxTableSchema.safeParse({ ...rates, fetchedOn }).success).toBe(false);
  });

  it("rejects a rate keyed by something that is not a currency code", () => {
    expect(fxTableSchema.safeParse({ ...rates, ratesPerBase: { usd: 1 } }).success).toBe(false);
  });
});
