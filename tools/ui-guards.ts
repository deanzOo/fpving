import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";

const RAW_COLOUR = String.raw`#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|oklch)\(`;
const RAW_COLOUR_MESSAGE = "Design system rule 1 (only tokens): raw colour. "
  + "Use a token from apps/ui/design/tokens.json, through a utility such as text-ink or var(--color-ink).";
const GENERATED_TOKENS = "tokens.css";

const stringGuard = (pattern: string, message: string) => [
  { selector: `Literal[value=/${pattern}/i]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/i]`, message },
];

/** The `no-restricted-syntax` entries for all of `apps/ui/src`, primitives included. */
export const uiSourceGuards = stringGuard(RAW_COLOUR, RAW_COLOUR_MESSAGE);

/**
 * Finds the raw colours in the stylesheets under a folder, where lint cannot reach. The generated `tokens.css` at the
 * folder's root is the one place they belong.
 *
 * @param folder - The folder to search.
 * @returns One line per raw colour: the file, the colour, the rule and what to use instead.
 */
export const rawColourFindings = async (folder: string): Promise<string[]> => {
  const findings: string[] = [];
  for await (const file of glob("**/*.css", { cwd: folder })) {
    if (file !== GENERATED_TOKENS) {
      const css = await readFile(join(folder, file), "utf8");
      for (const [colour] of css.matchAll(new RegExp(RAW_COLOUR, "giu"))) {
        findings.push(`${file}: ${colour}: ${RAW_COLOUR_MESSAGE}`);
      }
    }
  }
  return findings;
};
