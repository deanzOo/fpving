import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/index.ts";
import { convert } from "../../src/pricing/fx.ts";
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
const ZERO_RATE = 0;

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

  it("treats a rate that is not positive as missing", () => {
    const broken: FxTable = { ...rates, ratesPerBase: { ILS: ZERO_RATE } };
    expect(convert({ amountMinor: TEN_USD, currency: "USD" }, "ILS", broken)).toEqual(
      err({ kind: "missing_rate", currency: "ILS" }),
    );
  });
});
