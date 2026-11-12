import { expect } from "vitest";
import type { Locator } from "vitest/browser";

const NO_CONTENT = "none";

/** Whether `locator`'s element draws the reticle brackets, which live in its `::after`. */
export const hasBrackets = (locator: Locator): boolean =>
  getComputedStyle(locator.element(), "::after").content !== NO_CONTENT;

/** The computed style of `locator`'s element, or of its `pseudo` element. */
export const styleOf = (locator: Locator, pseudo?: string): CSSStyleDeclaration =>
  getComputedStyle(locator.element(), pseudo);

/** That keyboard focus is on `locator`'s element and that it draws no outline there. */
export const expectFocusedWithoutOutline = async (locator: Locator): Promise<void> => {
  await expect.element(locator).toHaveFocus();
  expect(locator.element().matches(":focus-visible")).toBe(true);
  expect(styleOf(locator).outlineStyle).toBe("none");
};

/** The value of a design token, such as `--color-ink-muted`, as the document resolves it now. */
export const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A colour in the `rgb()` form computed styles report. */
export const rgb = (hex: string): string => {
  const probe = document.createElement("span");
  probe.style.color = hex;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
};

/** That `word`, a badge's word, shows beside `glyph` (or none, with undefined) in the `ink` colour token. */
export const expectBadge = async (word: Locator, glyph: string | undefined, ink: string): Promise<void> => {
  await expect.element(word).toBeVisible();
  expect(word.element().previousElementSibling?.textContent).toBe(glyph);
  expect(getComputedStyle(word.element()).color).toBe(rgb(token(ink)));
};

/** The live status regions on the page now, to compare with where a later notice appears. */
export const statusRegions = (): Element[] => [...document.querySelectorAll("[role=status]")];

/** That `tag` showed up inside one of the status `regions` that were there before it had anything to say. */
export const expectSaidInPlace = async (tag: Locator, regions: readonly Element[]): Promise<void> => {
  await expect.element(tag).toBeVisible();
  expect(regions).toContain(tag.element().closest("[role=status]"));
};

/** That every live region on the page with nothing to say takes no room: no margin waits around it. */
export const expectEmptyRegionsTakeNoRoom = (): void => {
  const empty = [...document.querySelectorAll("[role=status]:empty")];
  expect(empty.length).toBeGreaterThan(0);
  expect(empty.map((region) => region.parentElement && getComputedStyle(region.parentElement).marginTop))
    .toEqual(empty.map(() => "0px"));
};
