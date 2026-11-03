import { glob, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { RAW_COLOUR, RAW_COLOUR_MESSAGE, UI_CLASS_RULES } from "./ui-guards.ts";

const GENERATED_TOKENS = "tokens.css";
const PRIMITIVES = `ui${sep}`;
const APPLY = /@apply\s[^;]+/gu;
const GLOBAL_IGNORE_CASE = "giu";

const matches = (text: string, pattern: string): string[] =>
  [...text.matchAll(new RegExp(pattern, GLOBAL_IGNORE_CASE))].map(([found]) => found.trim());

const appliedClassFindings = (css: string): string[] =>
  (css.match(APPLY) ?? []).flatMap((rule) => rule.split(/\s+/u).slice(1)).flatMap((name) => UI_CLASS_RULES
    .filter(({ pattern }) => matches(name, pattern).length > 0)
    .map(({ message }) => `${name}: ${message}`));

/**
 * Finds what lint cannot read in the stylesheets under a folder: raw colours anywhere but the generated `tokens.css`
 * at its root, and banned classes in an `@apply` outside its `ui` folder. This lives apart from `ui-guards.ts` because
 * ESLint's config imports that module natively, and that second instance reads as uncovered if it holds a function
 * only a test calls.
 *
 * @param folder - The folder to search.
 * @returns One line per finding: the file, what was found, the rule and what to use instead.
 * @throws Error when the folder holds no stylesheet to check, so an empty scan cannot pass.
 */
export const stylesheetFindings = async (folder: string): Promise<string[]> => {
  const findings: string[] = [];
  let scanned = 0;
  for await (const file of glob("**/*.css", { cwd: folder })) {
    if (file !== GENERATED_TOKENS) {
      scanned += 1;
      const css = await readFile(join(folder, file), "utf8");
      const raw = matches(css, RAW_COLOUR).map((colour) => `${colour}: ${RAW_COLOUR_MESSAGE}`);
      const applied = file.startsWith(PRIMITIVES) ? [] : appliedClassFindings(css);
      findings.push(...[...raw, ...applied].map((finding) => `${file}: ${finding}`));
    }
  }
  if (scanned === 0) {
    throw new Error(`no stylesheets to check under ${folder}`);
  }
  return findings;
};
