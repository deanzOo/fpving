const MODEL_NUMBER_WEIGHT = 0.6;
const WORD_WEIGHT = 1 - MODEL_NUMBER_WEIGHT;

const WORD = /[\p{L}\p{N}]+/gu;
const DIGIT = /\p{N}/u;

const words = (text: string): Set<string> => new Set(text.toLowerCase().match(WORD));

const shareOf = (part: readonly string[], whole: number): number => (whole === 0 ? 0 : part.length / whole);

/**
 * How alike a search result title is to the product, from 0 to 1, for ranking candidates before the LLM judges them.
 * Pure.
 *
 * @remarks
 * Both texts are split into lowercase words of letters and digits. A model number is a reference word holding a
 * digit, such as `2207`, `f60` or `6s`. The score weighs the share of the reference's model numbers found in the
 * title at 0.6 and the Jaccard index of the two word sets at 0.4, so a matching model number outranks many shared
 * generic words. A reference without model numbers is scored on the Jaccard index alone.
 *
 * @param reference - The product: its identity as text, or the source listing title when no identity is known.
 * @param candidateTitle - The search result title.
 * @returns The score, 1 when the title holds every word of the reference and nothing else.
 */
export const similarity = (reference: string, candidateTitle: string): number => {
  const ours = words(reference);
  const theirs = words(candidateTitle);
  const shared = [...ours].filter((word) => theirs.has(word));
  const jaccard = shareOf(shared, new Set([...ours, ...theirs]).size);
  const modelNumbers = [...ours].filter((word) => DIGIT.test(word));
  if (modelNumbers.length === 0) {
    return jaccard;
  }
  const matched = modelNumbers.filter((word) => theirs.has(word));
  return MODEL_NUMBER_WEIGHT * shareOf(matched, modelNumbers.length) + WORD_WEIGHT * jaccard;
};
