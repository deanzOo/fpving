import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RAW_COLOUR, RAW_COLOUR_MESSAGE } from "./ui-guards.ts";

const GENERATED_TOKENS = "tokens.css";

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
