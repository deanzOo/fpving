import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";

const RAW_COLOUR = String.raw`#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|oklch)\(`;
const RAW_COLOUR_MESSAGE = "Design system rule 1 (only tokens): raw colour. "
  + "Use a token from apps/ui/design/tokens.json, through a utility such as text-ink or var(--color-ink).";
const GENERATED_TOKENS = "tokens.css";

const COLOUR_UTILITY = "(?:bg|text|border|ring|outline|fill|stroke|decoration|accent|caret|divide|placeholder|shadow"
  + "|from|via|to)";
const PALETTE = "(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink"
  + String.raw`|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|black|white)`;
const PALETTE_CLASS = String.raw`\b${COLOUR_UTILITY}-${PALETTE}\b`;
const PALETTE_MESSAGE = "Design system rule 1 (only tokens): Tailwind palette class, which compiles to nothing here. "
  + "Use a token utility such as text-ink or bg-surface.";
const ARBITRARY_COLOUR_CLASS = String.raw`\b${COLOUR_UTILITY}-\[`;
const ARBITRARY_MESSAGE = "Design system rule 1 (only tokens): arbitrary value on a colour utility. "
  + "Use a token utility such as text-ink or bg-surface.";

const PRIMITIVE_FOR_NATIVE = {
  button: "Button",
  input: "TextField or Checkbox",
  select: "Select",
  textarea: "TextField, extended for several lines",
  table: "DataTable",
  dialog: "Confirm",
} as const;

const stringGuard = (pattern: string, message: string) => [
  { selector: `Literal[value=/${pattern}/i]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/i]`, message },
];

/** The `no-restricted-syntax` entries for all of `apps/ui/src`, primitives included. */
export const uiSourceGuards = stringGuard(RAW_COLOUR, RAW_COLOUR_MESSAGE);

/** The `no-restricted-syntax` entries for `apps/ui/src` outside the primitives in `apps/ui/src/ui`. */
export const uiScreenGuards = [
  ...uiSourceGuards,
  ...stringGuard(PALETTE_CLASS, PALETTE_MESSAGE),
  ...stringGuard(ARBITRARY_COLOUR_CLASS, ARBITRARY_MESSAGE),
  ...Object.entries(PRIMITIVE_FOR_NATIVE).map(([element, primitive]) => ({
    selector: `JSXOpeningElement[name.name="${element}"]`,
    message: `Design system rule 2 (shared primitives): native <${element}> outside apps/ui/src/ui. Use ${primitive}.`,
  })),
];

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
