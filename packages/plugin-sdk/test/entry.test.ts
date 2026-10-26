import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as contract from "../src/contract/index.ts";
import * as sdk from "../src/index.ts";

const IMPORT = /^(?:import|export)\b[^;]*from "([^"]+)";$/gm;

const importsReachableFrom = (file: URL, seen = new Set<string>()): Set<string> => {
  for (const [, specifier = ""] of readFileSync(file, "utf8").matchAll(IMPORT)) {
    if (!specifier.startsWith(".")) {
      seen.add(specifier);
      continue;
    }
    const next = new URL(specifier.replace(/\.js$/, ".ts"), file);
    if (seen.has(next.href)) continue;
    seen.add(next.href);
    importsReachableFrom(next, seen);
  }
  return seen;
};

describe("plugin-sdk entry points", () => {
  it("exports the plugin contract from the main entry", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "COUNTRY_CODES",
      "CURRENCY_CODES",
      "PluginCapability",
      "ShippingKind",
      "ShippingUnknown",
      "StoreErrorKind",
      "countryCodeSchema",
      "currencyCodeSchema",
      "err",
      "fetchedListingSchema",
      "manifestSchema",
      "moneySchema",
      "ok",
      "searchCandidateSchema",
      "shippingCostSchema",
      "shippingSchema",
      "storeErrorSchema",
    ]);
  });

  it("keeps vitest out of everything the main entry imports and confines it to the contract entry", () => {
    expect([...importsReachableFrom(new URL("../src/index.ts", import.meta.url))]).not.toContain("vitest");
    expect([...importsReachableFrom(new URL("../src/contract/index.ts", import.meta.url))]).toContain("vitest");
  });

  it("exports the contract test kit from the contract entry", () => {
    expect(Object.keys(contract).sort()).toEqual(["checkStorePluginContract", "runStorePluginContract"]);
  });
});
