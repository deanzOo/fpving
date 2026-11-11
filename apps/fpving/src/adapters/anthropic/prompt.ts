import { MATCHING_RULES } from "@fpving/core";

/** System prompt for extracting a product identity from a listing title. */
export const EXTRACT_SYSTEM = [
  "You read FPV drone gear listing titles from online stores.",
  "Return the brand, the model name and the variant attributes that tell this item apart from its siblings,",
  "such as KV, stator size, cell count, capacity, colour, radio protocol or video system.",
  "Use the brand's usual spelling and leave out store filler such as \"FPV\", \"racing\" or \"free shipping\".",
].join(" ");

/** System prompt for comparing two listing titles, judged by the core matching rules. */
export const COMPARE_SYSTEM = [
  "You compare two FPV drone gear listing titles: a source item and a candidate from another store.",
  "Answer whether the candidate is the same item, a variant of it, or a different item, with a one-line reason.",
  "Store titles spell, order and pad names differently; judge the item, not the wording. Rules:",
  ...MATCHING_RULES.map((rule) => `- ${rule}`),
].join("\n");

/**
 * The user turn for one title.
 *
 * @param title - The listing title.
 * @returns The message text.
 */
export const extractMessage = (title: string): string => `<title>${title}</title>`;

/**
 * The user turn for one pair of titles.
 *
 * @param source - The source title.
 * @param candidate - The candidate title.
 * @returns The message text.
 */
export const compareMessage = (source: string, candidate: string): string =>
  `<source>${source}</source>\n<candidate>${candidate}</candidate>`;

/** System prompt for reading the specs of a piece of gear from pasted text. */
export const SPECS_SYSTEM = [
  "You read pasted product text for FPV drone gear and fill in its specs.",
  "Use only what the text states. Answer null for every field the text does not state or that fits none of the",
  "allowed values; never guess or infer from the brand. Give the name only when the text states one.",
].join(" ");

/**
 * The user turn for one pasted text.
 *
 * @param kind - The kind of gear the text describes.
 * @param text - The pasted text.
 * @returns The message text.
 */
export const specsMessage = (kind: string, text: string): string => `<kind>${kind}</kind>\n<text>${text}</text>`;
