import { describe, expect, expectTypeOf, it } from "vitest";
import { StoreErrorKind } from "@fpving/plugin-sdk";
import {
  CandidateStatus,
  DEFAULT_SETTINGS,
  LlmVerdict,
  listingIdSchema,
  matchCandidateSchema,
  pluginIdSchema,
  productIdentitySchema,
  ScanOutcome,
  scanRunSchema,
  settingsSchema,
  verdictSchema,
} from "../src/index.ts";
import type { CurrencyCode, PluginId } from "../src/index.ts";

const ABOVE_ONE = 1.5;
const FIVE_PERCENT = 500;
const SCORE = 0.5;
const AT = new Date("2026-01-01T00:00:00.001Z");

const run = { id: "r1", pluginId: "example-shop", startedAt: AT, finishedAt: AT };
const candidate = {
  id: "c1",
  productId: "p1",
  pluginId: "example-shop",
  url: "https://shop.example/c1",
  title: "Candidate",
  similarityScore: SCORE,
  status: CandidateStatus.Pending,
};

describe("Domain entities", () => {
  it("accepts a plugin id only in the form a manifest allows, and brands it", () => {
    expect(pluginIdSchema.safeParse("example-shop").success).toBe(true);
    expect(pluginIdSchema.safeParse("Example_Shop").success).toBe(false);
    expectTypeOf<string>().not.toExtend<PluginId>();
  });

  it("ships default settings that pass the settings schema, with a 5% price drop threshold", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.priceDropMinBasisPoints).toBe(FIVE_PERCENT);
  });

  it("types the default settings as readonly all the way down, as they are frozen", () => {
    expectTypeOf(DEFAULT_SETTINGS.importTax.dutyFreeThreshold).toEqualTypeOf<
      Readonly<{ amountMinor: number; currency: CurrencyCode }>
    >();
    expect(Object.isFrozen(DEFAULT_SETTINGS.importTax.dutyFreeThreshold)).toBe(true);
  });

  it("rejects a negative or fractional price drop threshold", () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, priceDropMinBasisPoints: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, priceDropMinBasisPoints: ABOVE_ONE }).success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(listingIdSchema.safeParse("").success).toBe(false);
  });

  it("accepts only same, variant or different as an llm verdict", () => {
    expect(verdictSchema.safeParse({ verdict: LlmVerdict.Variant, reason: "Other size." }).success).toBe(true);
    expect(verdictSchema.safeParse({ verdict: LlmVerdict.Unjudged, reason: "None." }).success).toBe(false);
  });

  it("rejects an llm identity with a blank model", () => {
    expect(productIdentitySchema.safeParse({ brand: "DJI", model: " ", variantAttributes: [] }).success).toBe(false);
  });

  it("freezes the default settings, including the nested import tax rule", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.importTax)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.importTax.dutyFreeThreshold)).toBe(true);
  });

  it("requires a scan run error kind exactly when the run did not end ok", () => {
    expect(scanRunSchema.safeParse({ ...run, outcome: ScanOutcome.Ok, errorKind: null }).success).toBe(true);
    const failed = { ...run, outcome: ScanOutcome.Failed, errorKind: StoreErrorKind.Timeout };
    expect(scanRunSchema.safeParse(failed).success).toBe(true);
    const okWithError = { ...run, outcome: ScanOutcome.Ok, errorKind: StoreErrorKind.Network };
    expect(scanRunSchema.safeParse(okWithError).success).toBe(false);
    expect(scanRunSchema.safeParse({ ...run, outcome: ScanOutcome.Blocked, errorKind: null }).success).toBe(false);
  });

  it("requires an llm reason exactly when a candidate was judged", () => {
    const unjudged = { ...candidate, llmVerdict: LlmVerdict.Unjudged, llmReason: null };
    expect(matchCandidateSchema.safeParse(unjudged).success).toBe(true);
    const judged = { ...candidate, llmVerdict: LlmVerdict.Same, llmReason: "Identical." };
    expect(matchCandidateSchema.safeParse(judged).success).toBe(true);
    expect(matchCandidateSchema.safeParse({ ...unjudged, llmReason: "Why." }).success).toBe(false);
    expect(matchCandidateSchema.safeParse({ ...judged, llmReason: null }).success).toBe(false);
  });

  it("keeps a candidate similarity score between 0 and 1", () => {
    expect(matchCandidateSchema.shape.similarityScore.safeParse(ABOVE_ONE).success).toBe(false);
  });
});
