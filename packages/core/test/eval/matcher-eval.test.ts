import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matcherEvalFileSchema, MIN_MATCHER_PAIRS, scoreMatcher } from "../../eval/matcher-eval.ts";
import type { MatcherPair } from "../../eval/matcher-eval.ts";
import { LlmVerdict } from "../../src/index.ts";

const PAIRS_FILE = new URL("../../eval/pairs.json", import.meta.url);

const pair = (label: MatcherPair["label"]): MatcherPair => ({
  source: "T-Motor F60 Pro V 2207 1950KV",
  candidate: "T-Motor F60 Pro V 2207 2550KV",
  label,
  note: "KV differs",
});

describe("Matcher eval", () => {
  it("ships labelling rules and at least 40 labelled pairs covering same, variant and different", () => {
    const { rules, pairs } = matcherEvalFileSchema.parse(JSON.parse(readFileSync(PAIRS_FILE, "utf8")));
    expect(rules.length).toBeGreaterThan(0);
    expect(pairs.length).toBeGreaterThanOrEqual(MIN_MATCHER_PAIRS);
    expect(new Set(pairs.map((row) => row.label))).toEqual(
      new Set([LlmVerdict.Same, LlmVerdict.Variant, LlmVerdict.Different]),
    );
  });

  it("refuses a pairs file without rules, with too few pairs or with a label that is not a verdict", () => {
    const rules = ["same: the same item."];
    const valid = (file: unknown): boolean => matcherEvalFileSchema.safeParse(file).success;
    const few = Array.from({ length: MIN_MATCHER_PAIRS - 1 }, () => pair(LlmVerdict.Same));
    const many = Array.from({ length: MIN_MATCHER_PAIRS }, () => pair(LlmVerdict.Same));
    expect(valid({ rules, pairs: many })).toBe(true);
    expect(valid({ rules: [], pairs: many })).toBe(false);
    expect(valid({ rules, pairs: few })).toBe(false);
    expect(valid({ rules, pairs: [...many, { ...pair(LlmVerdict.Same), label: LlmVerdict.Unjudged }] })).toBe(false);
  });

  it("scores accuracy per label and overall, counting an unjudged verdict as wrong", () => {
    const pairs = [pair(LlmVerdict.Same), pair(LlmVerdict.Same), pair(LlmVerdict.Variant), pair(LlmVerdict.Different)];
    const verdicts = [LlmVerdict.Same, LlmVerdict.Unjudged, LlmVerdict.Variant, LlmVerdict.Same];
    expect(scoreMatcher(pairs, verdicts)).toEqual({
      overall: { correct: 2, total: 4, accuracy: 0.5 },
      same: { correct: 1, total: 2, accuracy: 0.5 },
      variant: { correct: 1, total: 1, accuracy: 1 },
      different: { correct: 0, total: 1, accuracy: 0 },
    });
  });

  it("reports no accuracy for a label without pairs", () => {
    expect(scoreMatcher([pair(LlmVerdict.Same)], [LlmVerdict.Same]).variant).toEqual({
      correct: 0,
      total: 0,
      accuracy: null,
    });
  });

  it("rejects verdicts that do not line up with the pairs as a bug", () => {
    expect(() => scoreMatcher([pair(LlmVerdict.Same)], [])).toThrow();
  });
});
