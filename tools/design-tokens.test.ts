import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { designTokens, renderTokensCss, writeTokensCss } from "./design-tokens.ts";

const COMMITTED = new URL("../apps/ui/src/tokens.css", import.meta.url);
const css = renderTokensCss(designTokens);

const section = (opening: string): string => {
  const start = css.indexOf(opening);
  expect(start, `the stylesheet has no ${opening}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
};

describe("Design tokens stylesheet", () => {
  it("is committed exactly as the generator writes it now, so run pnpm tokens after editing tokens.json", async () => {
    expect(await readFile(COMMITTED, "utf8")).toBe(css);
  });

  it("puts the light colours in the theme even though tokens.json lists dark first", () => {
    expect(section("@theme static")).toContain("--color-page: #e9edf0;");
    expect(section("@theme static")).not.toContain("#0e1216");
  });

  it("gives the dark colours to a system that prefers dark unless light is chosen", () => {
    const media = section("@media (prefers-color-scheme: dark)");
    expect(media).toContain(":root:not([data-theme=\"light\"]) {");
    expect(media).toContain("color-scheme: dark;");
    expect(media).toContain("--color-page: #0e1216;");
    expect(media).toContain("--shadow-dialog: 0 16px 40px rgba(0, 0, 0, 0.55);");
  });

  it("gives the same dark colours to an explicit dark choice", () => {
    const chosen = section(":root[data-theme=\"dark\"]");
    expect(chosen).toContain("color-scheme: dark;");
    expect(chosen).toContain("--color-signal: #62c3cd;");
  });

  it("resolves an alias to the variable it names, once, in the light theme", () => {
    expect(section("@theme static")).toContain("--color-chart-grid: var(--color-line);");
    expect(css.match(/--color-chart-axis:/gu)).toHaveLength(1);
  });

  it("carries the fonts, the 4px spacing base, the radii and the size tokens", () => {
    expect(css).toContain("--font-mono: \"Martian Mono\", ui-monospace, \"SF Mono\", Menlo, monospace;");
    expect(css).toContain("--spacing: 4px;");
    expect(css).toContain("--radius-1: 2px;");
    expect(section(":root {")).toContain("color-scheme: light;");
    expect(section(":root {")).toContain("--bracket-gap: 3px;");
  });

  it("writes a type utility per style, mono ones narrowed with tabular slashed figures", () => {
    expect(section("@utility type-title")).toContain("letter-spacing: -0.01em;");
    expect(section("@utility type-body")).not.toContain("letter-spacing");
    expect(section("@utility type-body")).not.toContain("font-stretch");
    expect(section("@utility type-readout {")).toContain("font-stretch: 87.5%;");
    expect(section("@utility type-readout {")).toContain("font-variant-numeric: tabular-nums slashed-zero;");
    expect(section("@utility type-label")).toContain("text-transform: uppercase;");
    expect(section("@utility type-code")).not.toContain("text-transform");
  });

  it("fails on a colour that is neither themed nor an alias", () => {
    const [first] = designTokens.color.tokens;
    const color = { ...designTokens.color, tokens: [{ name: "page", value: "#ffffff", usage: first?.usage ?? "" }] };
    expect(() => renderTokensCss({ ...designTokens, color })).toThrow("neither themed nor an alias");
  });

  it("fails on an alias to a colour token that does not exist", () => {
    const [first] = designTokens.color.tokens;
    const color = { ...designTokens.color, tokens: [{ name: "grid", value: "{lien}", usage: first?.usage ?? "" }] };
    expect(() => renderTokensCss({ ...designTokens, color })).toThrow("{lien} names no colour token");
  });

  it("keeps the shadow out of the theme, where Tailwind would copy its light value into the utility", () => {
    expect(section("@theme static")).not.toContain("--shadow-dialog");
    expect(section(":root {")).toContain("--shadow-dialog: 0 16px 40px rgba(16, 22, 27, 0.18);");
  });

  it("leaves Tailwind's own palette out, so only token colours exist", () => {
    expect(section("@theme static").split("\n")[1]?.trim()).toBe("--color-*: initial;");
  });

  it("leaves Tailwind's own radii out, so only the token radii exist", () => {
    const theme = section("@theme static");
    const reset = theme.indexOf("--radius-*: initial;");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(theme.indexOf("--radius-0:"));
  });

  it("always emits every type utility, even one no source file names yet", () => {
    expect(css).toContain("@source inline(\"type-title type-heading type-body type-control type-small type-readout-lg "
      + "type-readout type-label type-code chart-tick\");");
  });

  it("writes the chart tick style: the mono figures at the label size", () => {
    const figures = section("@utility chart-tick");
    expect(figures).toContain("font-family: var(--font-mono);");
    expect(figures).toContain("font-size: 11px;");
    expect(figures).toContain("font-stretch: 87.5%;");
    expect(figures).toContain("font-variant-numeric: tabular-nums slashed-zero;");
  });

  it("fails without the label style the chart ticks take their size from", () => {
    const groups = designTokens.type.groups.map((group) => ({
      ...group,
      styles: group.styles.filter(({ name }) => name !== "label"),
    }));
    expect(() => renderTokensCss({ ...designTokens, type: { ...designTokens.type, groups } }))
      .toThrow("type has no label style");
  });

  it("fails without a base spacing step", () => {
    const spacing = { ...designTokens.spacing, tokens: [] };
    expect(() => renderTokensCss({ ...designTokens, spacing })).toThrow("spacing has no space-1");
  });

  it("writes the stylesheet to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fpving-tokens-"));
    try {
      const output = join(dir, "tokens.css");
      await writeTokensCss(output);
      expect(await readFile(output, "utf8")).toBe(css);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
