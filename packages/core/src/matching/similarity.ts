const MODEL_NUMBER_WEIGHT = 0.6;
const WORD_WEIGHT = 1 - MODEL_NUMBER_WEIGHT;

const SEPARATORS = /[\s,;:()[\]{}+&|"']+/u;
const JOINERS = /[-_]/gu;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const DIGIT = /\p{N}/u;

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(SEPARATORS)
      .map((chunk) => chunk.replace(JOINERS, "").replace(EDGE_PUNCTUATION, ""))
      .filter((word) => word !== ""),
  );

const shareFound = (wanted: readonly string[], found: Set<string>): number =>
  wanted.length === 0 ? 0 : wanted.filter((word) => found.has(word)).length / wanted.length;

/**
 * How alike a search result title is to the product, from 0 to 1, for ranking candidates before the LLM judges them.
 * Pure.
 *
 * @remarks
 * - Words: both texts are lowercased and split on whitespace, commas, semicolons, colons, brackets, quotes, `+`,
 *   `&` and `|`. Hyphens and underscores inside a word are dropped, so `R-Line` and `RLine` are one word, and
 *   punctuation around a word is trimmed. Dots and slashes stay, so `5.8G` and `1/1.8` are whole words.
 * - A model number is a reference word holding a digit, such as `2207`, `f60` or `6s`.
 * - The score weighs the share of the reference's model numbers found in the title at 0.6 and the share of all its
 *   words found at 0.4, so a matching model number outranks many shared generic words, and a long title stuffed with
 *   extra words loses nothing. A reference without model numbers is scored on the share of its words alone.
 *
 * @param reference - The product: its identity as text, or the source listing title when no identity is known.
 * @param candidateTitle - The search result title.
 * @returns The score, 1 when the title holds every word of the reference.
 */
export const similarity = (reference: string, candidateTitle: string): number => {
  const ours = [...words(reference)];
  const theirs = words(candidateTitle);
  const contained = shareFound(ours, theirs);
  const modelNumbers = ours.filter((word) => DIGIT.test(word));
  if (modelNumbers.length === 0) {
    return contained;
  }
  return MODEL_NUMBER_WEIGHT * shareFound(modelNumbers, theirs) + WORD_WEIGHT * contained;
};
