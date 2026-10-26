import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LlmVerdict,
  listingIdSchema,
  matchCandidateSchema,
  productIdentitySchema,
  settingsSchema,
  verdictSchema,
} from "../src/index.ts";

const ABOVE_ONE = 1.5;
const FIVE_PERCENT = 500;

describe("Domain entities", () => {
  it("ships default settings that pass the settings schema, with a 5% price drop threshold", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.priceDropMinBasisPoints).toBe(FIVE_PERCENT);
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

  it("keeps a candidate similarity score between 0 and 1", () => {
    expect(matchCandidateSchema.shape.similarityScore.safeParse(ABOVE_ONE).success).toBe(false);
  });
});
