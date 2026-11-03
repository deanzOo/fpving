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
const MONO_FIGURES = "mono-figures";

const HEADER = "/* Generated from apps/ui/design/tokens.json by `pnpm tokens`. Do not edit. */";

const block = (selector: string, lines: readonly string[]): string =>
  [`${selector} {`, ...lines.flatMap((line) => line.split("\n")).map((line) => `  ${line}`), "}"].join("\n");

const colorValue = (value: ColorValue, theme: ThemeId, names: ReadonlySet<string>): string | undefined => {
  if (typeof value === "string") {
    const name = ALIAS.exec(value)?.groups?.["name"];
    if (name === undefined) {
      throw new Error(`colour value ${value} is neither themed nor an alias`);
    }
    if (!names.has(name)) {
      throw new Error(`alias ${value} names no colour token`);
    }
    return theme === ThemeId.Light ? `var(--color-${name})` : undefined;
  }
  return value[theme];
};

const colorLines = (source: Tokens, theme: ThemeId): string[] => {
  const names = new Set(source.color.tokens.map(({ name }) => name));
  return source.color.tokens.flatMap(({ name, value }) => {
    const resolved = colorValue(value, theme, names);
    return resolved === undefined ? [] : [`--color-${name}: ${resolved};`];
  });
};

const shadowLines = (source: Tokens, theme: ThemeId): string[] =>
  source.shadow.tokens.map(({ name, value }) => `--${name}: ${value[theme]};`);

const spacing = (source: Tokens): string => {
  const base = source.spacing.tokens.find(({ name }) => name === BASE_SPACING);
  if (base === undefined) {
    throw new Error(`spacing has no ${BASE_SPACING}`);
  }
  return base.value;
};

const MONO_SETTINGS = [`font-stretch: ${MONO_STRETCH};`, `font-variant-numeric: ${MONO_NUMERIC};`];

const typeUtility = (style: TypeStyle, family: string): string => block(`@utility type-${style.name}`, [
  `font-family: var(--font-${family});`,
  `font-size: ${style.fontSize};`,
  `line-height: ${style.lineHeight};`,
  `font-weight: ${String(style.fontWeight)};`,
  ...("letterSpacing" in style ? [`letter-spacing: ${style.letterSpacing};`] : []),
  ...(family === MONO ? MONO_SETTINGS : []),
  ...(UPPERCASE.has(style.name) ? ["text-transform: uppercase;"] : []),
]);

/**
 * The stylesheet for the design tokens: the light colours in Tailwind's `@theme`; the light shadow and the size
 * tokens on `:root`, so no utility copies the shadow's light value; the dark theme when the system prefers it and no
 * light choice is set, and again for an explicit dark choice; then the mono figure settings and one `type-*` utility
 * per type style, all emitted whether a source file names them or not.
 *
 * @param source - The design tokens.
 * @returns The CSS.
 */
export const renderTokensCss = (source: Tokens): string => {
  const dark = [
    `color-scheme: ${ThemeId.Dark};`,
    ...colorLines(source, ThemeId.Dark),
    ...shadowLines(source, ThemeId.Dark),
  ];
  const typeNames = source.type.groups.flatMap(({ styles }) => styles.map(({ name }) => `type-${name}`));
  return [
    HEADER,
    `@source inline("${[...typeNames, MONO_FIGURES].join(" ")}");`,
    block("@theme static", [
      "--color-*: initial;",
      ...colorLines(source, ThemeId.Light),
      ...Object.entries(source.type.families).map(([name, stack]) => `--font-${name}: ${stack};`),
      `--spacing: ${spacing(source)};`,
      ...source.radius.tokens.map(({ name, value }) => `--${name}: ${value};`),
    ]),
    block(":root", [
      `color-scheme: ${ThemeId.Light};`,
      ...shadowLines(source, ThemeId.Light),
      ...source.size.tokens.map(({ name, value }) => `--${name}: ${value};`),
    ]),
    block("@media (prefers-color-scheme: dark)", [block(":root:not([data-theme=\"light\"])", dark)]),
    block(":root[data-theme=\"dark\"]", dark),
    block(`@utility ${MONO_FIGURES}`, [`font-family: var(--font-${MONO});`, ...MONO_SETTINGS]),
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
