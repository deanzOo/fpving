import { scoreMatcher } from "../packages/core/eval/matcher-eval.ts";
import type { MatcherPair } from "../packages/core/eval/matcher-eval.ts";
import { LlmVerdict } from "../packages/core/src/index.ts";
import type { LlmJudge } from "../packages/core/src/index.ts";

export const MATCHER_EVAL_THRESHOLD = 0.9;

export const MATCHER_EVAL_SKIPPED = "Matcher eval skipped: no ANTHROPIC_API_KEY.";

const PERCENT = 100;
const PERCENT_DIGITS = 1;

/** The trimmed `ANTHROPIC_API_KEY`, or null when it is unset or blank. */
export const matcherEvalKey = (env: Readonly<Record<string, string | undefined>>): string | null => {
  const key = env["ANTHROPIC_API_KEY"]?.trim() ?? "";
  return key === "" ? null : key;
};

export interface MatcherEvalOutcome {
  readonly lines: string[];
  readonly passed: boolean;
}

/** Compares every labelled pair with the judge, scores the verdicts and reports each miss and each label's accuracy. */
export const evaluateMatcher = async (judge: LlmJudge, pairs: readonly MatcherPair[]): Promise<MatcherEvalOutcome> => {
  const verdicts = await Promise.all(pairs.map(async (pair) => {
    const judged = await judge.compare(pair.source, pair.candidate);
    return judged.ok ? judged.value.verdict : LlmVerdict.Unjudged;
  }));
  const misses = pairs.flatMap((pair, index) => (verdicts[index] === pair.label
    ? []
    : [`miss: ${pair.source} | ${pair.candidate}: expected ${pair.label}, got ${String(verdicts[index])}`]));
  const score = scoreMatcher(pairs, verdicts);
  const accuracies = Object.entries(score).map(([label, { correct, total, accuracy }]) => (accuracy === null
    ? `${label}: n/a`
    : `${label}: ${String(correct)}/${String(total)} (${(accuracy * PERCENT).toFixed(PERCENT_DIGITS)}%)`));
  return { lines: [...misses, ...accuracies], passed: (score.overall.accuracy ?? 0) >= MATCHER_EVAL_THRESHOLD };
};
