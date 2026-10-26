import type * as sdk from "@fpving/plugin-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import { err, ok } from "../src/index.ts";
import type { BrowserDriver, Clock, CountryCode, CurrencyCode, HttpClient, Logger, Result } from "../src/index.ts";

describe("Cross-package wiring", () => {
  it("re-exports the plugin-sdk Result helpers from core without a prior build", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("re-exports the plugin-sdk host capability and ISO code types from core", () => {
    expectTypeOf<Result<number, string>>().toEqualTypeOf<sdk.Result<number, string>>();
    expectTypeOf<HttpClient>().toEqualTypeOf<sdk.HttpClient>();
    expectTypeOf<BrowserDriver>().toEqualTypeOf<sdk.BrowserDriver>();
    expectTypeOf<Logger>().toEqualTypeOf<sdk.Logger>();
    expectTypeOf<Clock>().toEqualTypeOf<sdk.Clock>();
    expectTypeOf<CurrencyCode>().toEqualTypeOf<sdk.CurrencyCode>();
    expectTypeOf<CountryCode>().toEqualTypeOf<sdk.CountryCode>();
  });
});
