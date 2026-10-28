import { describe, expect, it } from "vitest";
import { LlmVerdict, MATCHING_RULES } from "../../src/index.ts";

describe("Matching rules", () => {
  it("state at least one rule for each verdict the judge can give, each rule led by its verdict", () => {
    const led = MATCHING_RULES.map((rule) => rule.split(":")[0]);
    expect(new Set(led)).toEqual(new Set([LlmVerdict.Same, LlmVerdict.Variant, LlmVerdict.Different]));
  });
});
