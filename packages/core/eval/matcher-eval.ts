import { z } from "zod";
import { LlmVerdict, verdictSchema } from "../src/index.ts";
import { textSchema } from "../src/text.ts";

/** The fewest labelled pairs the matcher eval runs on. */
export const MIN_MATCHER_PAIRS = 40;

const matcherPairSchema = z.object({
  source: textSchema,
  candidate: textSchema,
  label: verdictSchema.shape.verdict,
  note: textSchema,
});

/** One labelled pair: a source and a candidate listing title, the verdict a person gave, and why. */
export type MatcherPair = z.infer<typeof matcherPairSchema>;

/** The contents of `pairs.json`: the labelling rules, and at least {@link MIN_MATCHER_PAIRS} labelled pairs. */
export const matcherEvalFileSchema = z.object({
  rules: z.array(textSchema).min(1),
  pairs: z.array(matcherPairSchema).min(MIN_MATCHER_PAIRS),
});

interface Accuracy {
  readonly correct: number;
  readonly total: number;
  readonly accuracy: number | null;
}

/**
 * Over every pair and over the pairs of each label: how many verdicts matched the label, out of how many, and their
 * share, null when there were none.
 */
export type MatcherScore = Readonly<Record<"overall" | MatcherPair["label"], Accuracy>>;

interface Judged {
  readonly label: MatcherPair["label"];
  readonly verdict: LlmVerdict | undefined;
}

const accuracyOf = (rows: readonly Judged[]): Accuracy => {
  const correct = rows.filter((row) => row.verdict === row.label).length;
  return { correct, total: rows.length, accuracy: rows.length === 0 ? null : correct / rows.length };
};

/**
 * Scores the verdicts the matcher gave the labelled pairs against their labels. Pure. An `unjudged` verdict is
 * wrong.
 *
 * @param pairs - The labelled pairs.
 * @param verdicts - The verdict for each pair, in the same order.
 * @returns The accuracy overall and per label.
 */
export const scoreMatcher = (pairs: readonly MatcherPair[], verdicts: readonly LlmVerdict[]): MatcherScore => {
  if (pairs.length !== verdicts.length) {
    throw new Error(`${String(verdicts.length)} verdicts for ${String(pairs.length)} pairs`);
  }
  const judged = pairs.map((pair, index): Judged => ({ label: pair.label, verdict: verdicts[index] }));
  const labelled = (label: MatcherPair["label"]): Accuracy => accuracyOf(judged.filter((row) => row.label === label));
  return {
    overall: accuracyOf(judged),
    same: labelled(LlmVerdict.Same),
    variant: labelled(LlmVerdict.Variant),
    different: labelled(LlmVerdict.Different),
  };
};
