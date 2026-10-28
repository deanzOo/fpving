import { describe, expect, it } from "vitest";
import type { MatcherPair } from "../packages/core/eval/matcher-eval.ts";
import { err, LlmErrorKind, LlmVerdict, ok } from "@fpving/core";
import type { LlmJudge, Verdict } from "@fpving/core";
import { evaluateMatcher, MATCHER_EVAL_THRESHOLD, matcherEvalKey } from "./matcher-eval.ts";

const PAIRS = 10;
const MISSES_AT_THRESHOLD = Math.round(PAIRS * (1 - MATCHER_EVAL_THRESHOLD));

const pair = (index: number, label: MatcherPair["label"] = LlmVerdict.Same): MatcherPair => ({
  source: `Source ${String(index)}`,
  candidate: `Candidate ${String(index)}`,
  label,
  note: "test pair",
});

const judgeAnswering = (answer: (source: string) => Verdict | null): LlmJudge => ({
  extractIdentity: () => Promise.resolve(err({ kind: LlmErrorKind.Unavailable, detail: "unused" })),
  compare: (source) => {
    const verdict = answer(source);
    return Promise.resolve(verdict === null ? err({ kind: LlmErrorKind.Unavailable, detail: "down" }) : ok(verdict));
  },
});

const sameFor = (correct: number) => judgeAnswering((source) => ({
  verdict: Number(source.split(" ")[1]) < correct ? LlmVerdict.Same : LlmVerdict.Different,
  reason: "test",
}));

const pairs = Array.from({ length: PAIRS }, (_, index) => pair(index));

describe("Matcher eval run", () => {
  it("passes at the accuracy threshold and prints each label's accuracy", async () => {
    const outcome = await evaluateMatcher(sameFor(PAIRS - MISSES_AT_THRESHOLD), pairs);
    expect(outcome.passed).toBe(true);
    expect(outcome.lines).toContain("overall: 9/10 (90.0%)");
    expect(outcome.lines).toContain("same: 9/10 (90.0%)");
    expect(outcome.lines).toContain("variant: n/a");
  });

  it("fails below the threshold and lists every pair it got wrong", async () => {
    const outcome = await evaluateMatcher(sameFor(PAIRS - MISSES_AT_THRESHOLD - 1), pairs);
    expect(outcome.passed).toBe(false);
    expect(outcome.lines).toContain("miss: Source 9 | Candidate 9: expected same, got different");
    expect(outcome.lines.filter((line) => line.startsWith("miss:"))).toHaveLength(MISSES_AT_THRESHOLD + 1);
  });

  it("counts a pair the judge could not answer as unjudged and wrong", async () => {
    const outcome = await evaluateMatcher(judgeAnswering(() => null), [pair(0, LlmVerdict.Variant)]);
    expect(outcome.passed).toBe(false);
    expect(outcome.lines).toContain("miss: Source 0 | Candidate 0: expected variant, got unjudged");
  });

  it("fails when there are no pairs to score", async () => {
    expect((await evaluateMatcher(sameFor(0), [])).passed).toBe(false);
  });
});

describe("Matcher eval key", () => {
  it.each([
    ["unset", {}],
    ["empty", { ANTHROPIC_API_KEY: "" }],
    ["whitespace only", { ANTHROPIC_API_KEY: " \t\n" }],
  ])("is missing when ANTHROPIC_API_KEY is %s", (_, env) => {
    expect(matcherEvalKey(env)).toBeNull();
  });

  it("is ANTHROPIC_API_KEY without surrounding whitespace", () => {
    expect(matcherEvalKey({ ANTHROPIC_API_KEY: " test-key-not-a-real-secret\n" })).toBe("test-key-not-a-real-secret");
  });
});
