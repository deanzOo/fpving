import { expect } from "vitest";
import type { Locator } from "vitest/browser";

const NO_CONTENT = "none";

/** Whether `locator`'s element draws the reticle brackets, which live in its `::after`. */
export const hasBrackets = (locator: Locator): boolean =>
  getComputedStyle(locator.element(), "::after").content !== NO_CONTENT;

/** The computed style of `locator`'s element, or of its `pseudo` element. */
export const styleOf = (locator: Locator, pseudo?: string): CSSStyleDeclaration =>
  getComputedStyle(locator.element(), pseudo);

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
