import { writeFile } from "node:fs/promises";
import tokens from "../apps/ui/design/tokens.json" with { type: "json" };

type Tokens = typeof tokens;
type ColorValue = Tokens["color"]["tokens"][number]["value"];
type TypeStyle = Tokens["type"]["groups"][number]["styles"][number];

const ThemeId = { Light: "light", Dark: "dark" } as const;
type ThemeId = (typeof ThemeId)[keyof typeof ThemeId];

const ALIAS = /^\{(?<name>[a-z0-9-]+)\}$/u;
const MONO = "mono";
const UPPERCASE: ReadonlySet<string> = new Set(["label"]);
const MONO_STRETCH = "87.5%";
const MONO_NUMERIC = "tabular-nums slashed-zero";
const BASE_SPACING = "space-1";

const HEADER = "/* Generated from apps/ui/design/tokens.json by `pnpm tokens`. Do not edit. */";

const block = (selector: string, lines: readonly string[]): string =>
  [`${selector} {`, ...lines.flatMap((line) => line.split("\n")).map((line) => `  ${line}`), "}"].join("\n");

const colorValue = (value: ColorValue, theme: ThemeId): string | undefined => {
  if (typeof value === "string") {
    const name = ALIAS.exec(value)?.groups?.["name"];
    if (name === undefined) {
      throw new Error(`colour value ${value} is neither themed nor an alias`);
    }
    return theme === ThemeId.Light ? `var(--color-${name})` : undefined;
  }
  return value[theme];
};

const themedLines = (source: Tokens, theme: ThemeId): string[] => [
  ...source.color.tokens.flatMap(({ name, value }) => {
    const resolved = colorValue(value, theme);
    return resolved === undefined ? [] : [`--color-${name}: ${resolved};`];
  }),
  ...source.shadow.tokens.map(({ name, value }) => `--${name}: ${value[theme]};`),
];

const spacing = (source: Tokens): string => {
  const base = source.spacing.tokens.find(({ name }) => name === BASE_SPACING);
  if (base === undefined) {
    throw new Error(`spacing has no ${BASE_SPACING}`);
  }
  return base.value;
};

const typeUtility = (style: TypeStyle, family: string): string => block(`@utility type-${style.name}`, [
  `font-family: var(--font-${family});`,
  `font-size: ${style.fontSize};`,
  `line-height: ${style.lineHeight};`,
  `font-weight: ${String(style.fontWeight)};`,
  ...("letterSpacing" in style ? [`letter-spacing: ${style.letterSpacing};`] : []),
  ...(family === MONO ? [`font-stretch: ${MONO_STRETCH};`, `font-variant-numeric: ${MONO_NUMERIC};`] : []),
  ...(UPPERCASE.has(style.name) ? ["text-transform: uppercase;"] : []),
]);

/**
 * The stylesheet for the design tokens: the light theme in Tailwind's `@theme`, the dark theme when the system
 * prefers it and no light choice is set, and again for an explicit dark choice, then the size tokens and one
 * `type-*` utility per type style.
 *
 * @param source - The design tokens.
 * @returns The CSS.
 */
export const renderTokensCss = (source: Tokens): string => {
  const dark = [`color-scheme: ${ThemeId.Dark};`, ...themedLines(source, ThemeId.Dark)];
  return [
    HEADER,
    block("@theme static", [
      ...themedLines(source, ThemeId.Light),
      ...Object.entries(source.type.families).map(([name, stack]) => `--font-${name}: ${stack};`),
      `--spacing: ${spacing(source)};`,
      ...source.radius.tokens.map(({ name, value }) => `--${name}: ${value};`),
    ]),
    block(":root", [
      `color-scheme: ${ThemeId.Light};`,
      ...source.size.tokens.map(({ name, value }) => `--${name}: ${value};`),
    ]),
    block("@media (prefers-color-scheme: dark)", [block(":root:not([data-theme=\"light\"])", dark)]),
    block(":root[data-theme=\"dark\"]", dark),
    ...source.type.groups.flatMap(({ family, styles }) => styles.map((style) => typeUtility(style, family))),
  ].join("\n\n").concat("\n");
};

/** The committed design tokens. */
export const designTokens: Tokens = tokens;

/**
 * Writes the stylesheet for the committed design tokens.
 *
 * @param output - Where to write it.
 */
export const writeTokensCss = async (output: string): Promise<void> => {
  await writeFile(output, renderTokensCss(designTokens));
};
