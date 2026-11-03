---
title: Design system
description: The OSD direction, how tokens reach the code, the primitives, the rules and how to add a screen or a primitive.
---

The interface borrows from the on-screen display in FPV goggles: a cool graphite field, readouts in a compact mono face, thin rules and one cyan signal for what is live. It should feel dense, technical and calm. Nothing blinks unless a scan is running. Dark is the hero theme and light is its daylight counterpart, with the same roles.

The design system itself is a Claude Design artifact: <https://claude.ai/artifact/D9wEwSSwTYinNor4a3hYuA>. It holds the guidelines for voice, colour, type, space, the reticle, motion, iconography and charts. This page covers how the code follows it. [ADR 0031](../adr/0031-design-system-tokens-fonts-and-theme-switch/) records how the tokens, the fonts and the theme switch were decided.

## Change a token

`apps/ui/design/tokens.json` is the design system's file, committed verbatim. `apps/ui/src/tokens.css` is generated from it and is never edited by hand.

1. Change the token in the design system, or add one there if a role is missing.
2. Copy its `tokens.json` over `apps/ui/design/tokens.json`.
3. Run `pnpm tokens`, which rewrites `apps/ui/src/tokens.css`.
4. Check any new colour pair against rule 8 in both themes.
5. Commit both files. A test fails when the committed `tokens.css` differs from what the generator writes.

## Primitives

The primitives live in `apps/ui/src/ui/`. If one nearly fits, extend it instead of styling around it.

| Primitive | Use it for |
| --- | --- |
| `Button` | One action, labelled with its verb. Primary, secondary or ghost, regular or small, with `pending` and `pendingLabel`. |
| `Confirm` | A button that asks first in a modal dialog, for a destructive step. The only place the danger fill appears. |
| `TextField` | A labelled single-line input with a hint or an error. `numeric` types in the readout face. |
| `Select` | A closed set of values, with the same label, hint and error wiring as `TextField`. |
| `Checkbox` | A toggle with its label to the right. |
| `Badge` | A short uppercase status: a word, a glyph where it has one, and a tone. |
| `Count` | The unread number in the nav bar. |
| `Price` | Any money: always `formatMoney` in the mono face, with the change since a previous price, and a sentence when it is missing. |
| `DataTable` | Dense rows of readouts, with a caption, a row header and row actions. |
| `Panel` | A `surface` block for a chart, a form or a summary. `featured` frames the one panel per screen that is the reason to look. |
| `Notice`, `Done` | One announced sentence about what just happened, with a tag. `Done` is the tagged outcome of something the user did. |
| `EmptyState` | What a list, table or chart shows when it has nothing: a tag and a sentence that says what to do. |
| `NavBar`, `ThemeSwitch` | The app's navigation and its theme choice. Used once, by the layout. |
| `ScanStatus` | Scan now with its status line, the one place the interface moves. |
| `Sparkline` | The small price trend in a row. |
| `chart-theme.tsx` | The series order, grid, axis, line, legend and tooltip for a price chart. |
| `LINK` | The classes of a text link, for a router `Link` or an anchor. |

## The rules

1. Only tokens. No hex, rgb or Tailwind palette colours in components. If a role is missing, add a token first.
2. Use the shared primitives instead of restyling native elements per screen.
3. Mono for money and every compared number, with tabular figures. Sans for words.
4. Brackets only for focus, the current nav item, or the one featured element on a screen.
5. One primary button per form or header. Danger fill only inside Confirm.
6. Status is a word plus a glyph plus a colour, never colour alone. Status colours are never chart series.
7. Pending is `aria-disabled` and a changed label, never `opacity`.
8. Text meets 4.5:1 and borders, focus and marks 3:1 in both themes. Check new pairs before shipping.

### What fails `pnpm verify`

Lint, in `eslint.config.ts` with the patterns and messages in `tools/ui-guards.ts`, covers the strings and JSX in `apps/ui/src`. Lint cannot read a stylesheet, so a tooling test covers those. A class name built at run time is out of reach of both, and would not compile under Tailwind anyway.

| Guard | Where it applies | What to use |
| --- | --- | --- |
| Raw colours: hex, `rgb()`, `hsl()`, `oklch()` | All of `apps/ui/src`, stylesheets included, except the generated `tokens.css` | A token, through a utility or `var(--color-…)` |
| Tailwind palette classes such as `text-red-500`, and `text-white` or `bg-black`. They compile to nothing here, because the palette is reset. | Outside `ui/` | A token utility |
| Arbitrary values on a colour utility, such as `bg-[#123456]` or `border-[red]` | Outside `ui/` | A token utility |
| JSX `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>`, `<dialog>` | Outside `ui/` | The primitive the message names |
| `opacity-*` classes | Outside `ui/` | `aria-disabled` and a changed label, through `Button` |
| `text-xs` through `text-9xl`, and `font-bold` | Outside `ui/` | A `type-*` utility |

The hex pattern also matches a string that only looks like a colour, such as an anchor named `#add`. Rename the anchor.

### Agreed exceptions to the design

- Back in stock, gone and removed badges have no glyph: word and colour only, so each glyph keeps one meaning.
- Refusal notices are tagged REFUSED or FAILED. A restart is a warning tagged RESTARTING. The startup 503 is a warning tagged STARTING. A partial Find matches result is a warning tagged PARTIAL.
- The watchlist's unread count is a `Badge`, not a `Count`.
- Scan now keeps its label while running. Its status line changes instead.
- The settings form is half of `--content-max` wide (512px), which is not a design token.

## Add a screen

1. Write the failing test in `apps/ui/test/`, with `renderApp` and the fake API in `apps/ui/test/support/`.
2. Add the screen as a module in `apps/ui/src/` and its route in `app.tsx`. A top-level screen also gets a link in `NavBar`.
3. Give it one `h1` in `type-title`, and `h2` sections in `type-heading`.
4. Build it from the primitives and the `type-*` and token utilities. Show a refusal with `Refused`, an outcome with `Done` or `Notice`, and nothing to show with `EmptyState`.
5. Write the copy in the design system's voice: the user's own nouns, sentence case, and the next step when something is refused.

## Add a primitive

Add one when a second screen needs the same thing, or when a screen would otherwise break a guard. A variant of an existing primitive is usually the smaller change.

1. Write the failing test in `apps/ui/test/ui/`, covering its look in both themes and its keyboard and screen reader behaviour.
2. Add the component in `apps/ui/src/ui/`, with TSDoc saying what it is for. Variants are `as const` objects.
3. Use tokens only. The raw colour guard applies inside `ui/` too. The other guards do not, because a primitive is where a native control and its styling belong.
4. Add it to the table on this page and to the design system.
