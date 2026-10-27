import { describe, expect, it } from "vitest";
import * as core from "../src/index.ts";

describe("Core public API", () => {
  it("exports the pricing functions, entity and id schemas and port error kinds, keeping helpers internal", () => {
    expect(Object.keys(core).sort()).toEqual([
      "AddErrorKind",
      "AlertKind",
      "COUNTRY_PRESETS",
      "CandidateStatus",
      "DEFAULT_SETTINGS",
      "ListingOrigin",
      "ListingStatus",
      "LlmErrorKind",
      "LlmVerdict",
      "PortErrorKind",
      "PricingErrorKind",
      "RepositoryErrorKind",
      "ScanOutcome",
      "ThresholdBasis",
      "alertIdSchema",
      "alertSchema",
      "cachedVerdictSchema",
      "convert",
      "err",
      "evaluate",
      "importTax",
      "landedCost",
      "listingIdSchema",
      "listingSchema",
      "matchCandidateIdSchema",
      "matchCandidateSchema",
      "normalizeListingUrl",
      "ok",
      "pluginHealthSchema",
      "pluginIdSchema",
      "presetFor",
      "priceSnapshotSchema",
      "productIdSchema",
      "productIdentitySchema",
      "productSchema",
      "scanRunIdSchema",
      "scanRunSchema",
      "settingsSchema",
      "snapshotIdSchema",
      "verdictSchema",
    ]);
  });
});
