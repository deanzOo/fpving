import { describe, expect, expectTypeOf, it } from "vitest";
import { PortErrorKind, PricingErrorKind } from "../src/index.ts";
import type { ShippingUnknownError } from "../src/index.ts";

describe("Error kinds", () => {
  it("names every pricing failure by its snake_case kind", () => {
    expect(PricingErrorKind).toEqual({
      MissingRate: "missing_rate",
      AmountOutOfRange: "amount_out_of_range",
      ShippingUnknown: "shipping_unknown",
    });
  });

  it("keeps the shipping_unknown error distinct from the SDK ShippingUnknown value", () => {
    expectTypeOf<ShippingUnknownError>().toEqualTypeOf<{ kind: "shipping_unknown" }>();
  });

  it("names every port failure by its snake_case kind", () => {
    expect(PortErrorKind).toEqual({
      RatesUnavailable: "rates_unavailable",
      NotifyFailed: "notify_failed",
      DebugWriteFailed: "debug_write_failed",
    });
  });
});
