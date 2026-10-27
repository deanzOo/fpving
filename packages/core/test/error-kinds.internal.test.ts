import { describe, expect, expectTypeOf, it } from "vitest";
import { AddErrorKind, MatchErrorKind, PortErrorKind, PricingErrorKind, SchedulerErrorKind } from "../src/index.ts";
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

  it("names every reason adding a product or listing failed by its snake_case kind", () => {
    expect(AddErrorKind).toEqual({
      InvalidUrl: "invalid_url",
      NoPluginForDomain: "no_plugin_for_domain",
      AlreadyTracked: "already_tracked",
      FetchFailed: "fetch_failed",
    });
  });

  it("names every reason assisted matching did nothing by its snake_case kind", () => {
    expect(MatchErrorKind).toEqual({ NoSourceListing: "no_source_listing", NotPending: "not_pending" });
  });

  it("names the reason a scan on demand did nothing by its snake_case kind", () => {
    expect(SchedulerErrorKind).toEqual({ Stopped: "stopped" });
  });
});
