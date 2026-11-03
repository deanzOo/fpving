---
title: "0031. Design system: tokens, fonts and the theme switch"
description: Where the UI's design tokens come from, how they become CSS, how the faces are bundled under the CSP and how a viewer picks a theme.
---

- Status: Accepted
- Date: 2026-11-02

## Context and problem statement

The UI had a hand-written Tailwind `@theme` with a handful of colours, system fonts and restyled native elements on each screen. The interface now has a design system, "fpving" (direction: the on-screen display of FPV goggles), kept as a Claude Design artifact at <https://claude.ai/artifact/D9wEwSSwTYinNor4a3hYuA>. It defines the colour, type, spacing, radius, shadow and size tokens in `tokens.json`, with a dark and a light value for every colour, and a guideline for each shared component. The code needs those tokens without copying values by hand, the two faces it names without breaking the `default-src 'self'` CSP, and a way for a viewer to choose a theme other than the operating system's.

## Considered options

- Token source: copy values into `styles.css` by hand, or commit `tokens.json` and generate the CSS. Chosen: generate. A hand copy drifts from the design system on the next change; a committed source and a check that the generated file is current cannot.
- Dark theme mechanism: the CSS `light-dark()` function behind `color-scheme`, or the dark values written out under a `prefers-color-scheme: dark` rule and again for an explicit choice. Chosen: the written-out values. `light-dark()` would work, the dialog shadow included, since only its colour differs (`0 16px 40px light-dark(…, …)`), but it would mean splitting the shadow token into a geometry and a colour that `tokens.json` does not have, and the written-out blocks keep each token's value readable as `tokens.json` states it.
- Fonts: Google Fonts, which the CSP forbids; copied font files; or the `@fontsource` packages bundled by Vite. Chosen: `@fontsource`, pinned, so the files come from the lockfile and Vite serves them from the app's own origin.
- Theme choice: follow the operating system only, or a System, Light and Dark switch remembered per browser. Chosen: the switch, with System as the default.

## Decision outcome

`apps/ui/design/tokens.json` is the design system's file, committed verbatim. `pnpm tokens` runs `tools/design-tokens.ts`, which writes `apps/ui/src/tokens.css`:

- `--color-*: initial` and `--radius-*: initial`, so Tailwind's stock palette and radii do not exist and only token colours and radii can be used;
- the light colours, the font stacks, `--spacing: 4px` (the `space-1` step) and the radii in Tailwind's `@theme static`, so every token is a CSS variable whether a utility uses it or not, even though `tokens.json` lists dark first;
- the light shadow and the size tokens (`hairline`, the reticle bracket measures, `control-height`, `row-height`, `content-max`) as plain variables on `:root`;
- the dark colours and shadow under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `:root[data-theme="dark"]`, each with the matching `color-scheme`;
- an alias such as `{line}` as `var(--color-line)`, once, since it follows its target in both themes; an alias to a token that does not exist fails the generator;
- one `type-*` utility per type style (`title`, `heading`, `body`, `control`, `small`, `readout-lg`, `readout`, `label`, `code`); the mono ones add `font-stretch: 87.5%` and tabular, slashed-zero figures, and `label` is uppercase. A `chart-tick` utility carries the mono face with those settings at the `label` size, for chart ticks, so the app reads no `tokens.json` at run time; the generator fails if the `label` style is missing. An `@source inline(…)` line makes Tailwind emit all of these even before a source file names them.

`styles.css` imports `tokens.css` and keeps only base and component-layer rules: the focus reticle, the motion marks and the pseudo-element pieces of the primitives. A tooling test fails when the committed `tokens.css` differs from what the generator writes now. The old `action`, `on-action` and `focus` colours are gone; `signal` and `on-signal` replace them. Tailwind copies a `--shadow-*` theme value into its `shadow-*` utility at build time, so a dark redefinition would never reach a `shadow-dialog` utility. The shadow therefore stays out of `@theme`, and the dialog uses `shadow-(--shadow-dialog)`, which reads the variable at run time. Colours, radii, fonts and spacing compile to `var(--…)` and are safe in `@theme`. The generated file is left out of the duplication check, because its two dark blocks repeat by design.

The faces are `@fontsource/ibm-plex-sans` 5.3.0 (weights 400, 500 and 600) and `@fontsource-variable/martian-mono` 5.3.0 (the width and weight axes), both OFL-1.1, which is compatible with AGPL-3.0 for bundled fonts. The variable package names its family "Martian Mono Variable" while the tokens name "Martian Mono", so `fonts.css` declares the latin and latin-ext faces itself under the tokens' name, pointing at the package's files; knip cannot see a dependency used only from a CSS `url()`, so `knip.json` names it. The built CSS refers only to font files under `/assets/`.

The theme switch is a radio group in the nav bar. Light and Dark set `data-theme` on `<html>` and are stored in `localStorage`; System removes both and leaves the choice to the operating system. A browser that blocks storage gets System on load and a choice that lasts for the page.

The stored choice is applied by `apps/ui/public/theme-boot.js`, a classic script linked in `<head>` before the stylesheet. A classic script without `async` or `defer` blocks parsing and rendering, so it sets `data-theme` before the first frame and there is no flash of the other theme. The CSP needs no change: `default-src 'self'` allows a same-origin script file, and nothing is inline. The file repeats the storage key and the two theme names from `theme.ts`; a browser test runs it beside `applyTheme(readTheme())` for every stored value and a blocked store, so the two cannot drift, and another loads `index.html` in a fresh page and checks that a stored dark theme is on `<html>` at the first animation frame.

## Consequences

- Good: a design system change is a new `tokens.json` and `pnpm tokens`; a stale stylesheet fails the tests.
- Good: the faces load from the app's origin and the CSP stays `default-src 'self'`; the fallback stacks keep the layout if they fail.
- Good: a chosen theme is in place at the first frame, under the unchanged CSP.
- Bad: the boot script duplicates the key and the theme names, held in step by a test rather than by an import.
- Bad: two font packages to keep current, and a hand-kept pair of `@font-face` rules for the mono face's family name.
