import { describe, expect, it } from "vitest";
import * as check from "../src/contract/check.ts";
import * as contract from "../src/contract/index.ts";
import * as sdk from "../src/index.ts";
import { importsReachableFrom } from "../../../tools/imports-reachable.ts";

describe("plugin-sdk entry points", () => {
  it("exports the plugin contract from the main entry", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "COUNTRY_CODES",
      "CURRENCY_CODES",
      "CURRENCY_MINOR_UNITS",
      "PluginCapability",
      "ShippingKind",
      "ShippingUnknown",
      "StoreErrorKind",
      "amountSchema",
      "countryCodeSchema",
      "currencyCodeSchema",
      "err",
      "fetchedListingSchema",
      "httpUrlSchema",
      "manifestSchema",
      "moneySchema",
      "ok",
      "searchCandidateSchema",
      "shippingSchema",
      "storeErrorSchema",
    ]);
  });

  it("keeps vitest out of everything the main and check entries import and confines it to the contract entry", () => {
    expect([...importsReachableFrom(new URL("../src/index.ts", import.meta.url))]).not.toContain("vitest");
    expect([...importsReachableFrom(new URL("../src/contract/check.ts", import.meta.url))]).not.toContain("vitest");
    expect([...importsReachableFrom(new URL("../src/contract/index.ts", import.meta.url))]).toContain("vitest");
  });

  it("exports the Vitest suite from the contract entry", () => {
    expect(Object.keys(contract)).toEqual(["runStorePluginContract"]);
  });

  it("exports the runner-free contract check from the check entry", () => {
    expect(Object.keys(check)).toEqual(["checkStorePluginContract"]);
  });
});
