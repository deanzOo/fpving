/** The colour theme a viewer can choose; System leaves it to the operating system's preference. */
export const Theme = { System: "system", Light: "light", Dark: "dark" } as const;
/** One of the {@link Theme} choices. */
export type Theme = (typeof Theme)[keyof typeof Theme];

/** Where the chosen theme is stored; `public/theme-boot.js` reads the same key. */
export const THEME_KEY = "fpving.theme";
const THEMES: readonly string[] = Object.values(Theme);
const isTheme = (value: string | null): value is Theme => value !== null && THEMES.includes(value);

const refused = (error: unknown): null => {
  if (error instanceof DOMException) {
    return null;
  }
  throw error;
};

/**
 * The theme this browser remembers, or System when none is stored or the browser blocks storage.
 *
 * @returns The theme.
 */
export const readTheme = (): Theme => {
  let stored: string | null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch (error) {
    stored = refused(error);
  }
  return isTheme(stored) ? stored : Theme.System;
};

/**
 * Remembers the theme for the next visit; System forgets the choice. When the browser blocks storage the choice
 * lasts for this page only.
 *
 * @param theme - The chosen theme.
 */
export const saveTheme = (theme: Theme): void => {
  try {
    if (theme === Theme.System) {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, theme);
    }
  } catch (error) {
    refused(error);
  }
};

/**
 * Sets `data-theme` on the document for Light or Dark, and removes it for System so the operating system decides.
 *
 * @param theme - The theme.
 */
export const applyTheme = (theme: Theme): void => {
  if (theme === Theme.System) {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = theme;
  }
};
