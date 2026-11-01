---
title: Contributing
description: How to set up, what the gates are, and when a decision record is required.
---

The full guide is [CONTRIBUTING.md](https://github.com/deanzoo/fpving/blob/main/CONTRIBUTING.md). A summary:

## Setup

1. Install Node 24 (`nvm install` reads `.nvmrc`) and enable corepack.
2. `pnpm install`, then `pnpm --filter @fpving/app exec playwright install chromium` for the UI tests.
3. `pnpm verify` is the local gate: it runs the build (which typechecks), lint, tests with the coverage gate, the docs build, duplication, unused-code and license checks. CI also runs gitleaks, osv-scanner, commitlint and the lychee link check.
4. `pnpm worktree:init` writes this worktree's `.env` from `.env.example`: `PORT` is `4000 + fnv1a(absolute worktree path) % 1000` and `DATA_DIR` is the absolute path `<worktree path>/.data/<worktree directory name>`; the app rejects a relative `DATA_DIR`. It never overwrites an existing `.env` and exits 0 when one exists. The app's logs and browser profile live in `DATA_DIR`, so they are per worktree too; the E2E suite uses a temp Chromium profile, `DATA_DIR` and port per test instead. See [ADR 0015](../adr/0015-per-worktree-env-and-port/).
5. `pnpm docs:dev` serves this site locally. Run `pnpm test` once first so the behaviour spec page can be generated.

## End-to-end journey

`pnpm test` includes the `e2e` project, which builds the UI, starts the app in process with fake LLM, rates and notifier, and drives Chromium from adding a product to its price drop alert. Run it alone with `pnpm vitest run --project e2e`; `FPVING_E2E_HEADED=1` shows the browser. It stays out of the coverage run (`verify` runs it as `pnpm test:e2e`). Its setup empties and rebuilds `apps/ui/dist/web`, which a running app or dev server serving that folder briefly loses, and in watch mode it builds once per session, so restart Vitest after a UI change. See [ADR 0029](../adr/0029-in-process-e2e-with-vitest-and-the-playwright-library/).

## Rules in brief

- Write a failing test before the implementation. Test names read as requirements, and describe names are sentence case. Name a test file `*.internal.test.ts` when it checks implementation detail such as a test fake or the shape of a public entry; the behaviour specification leaves it out.
- Coverage is a hard 100% gate on lines, branches, functions and statements.
- Formatting is ESLint-enforced (`@stylistic`), with no Prettier.
- Strict TypeScript: no `any`, no `as` except `as const`, no `!`, no `@ts-*`, no `eslint-disable`.
- No narrative comments. Every exported symbol in `packages/core/src` and `packages/plugin-sdk/src` carries TSDoc, which lint enforces.
- Conventional Commits, squash merged through pull requests.

## Docs

Behaviour changes update the relevant guide. The API reference is generated from TSDoc and the behaviour specification from test names, so neither is edited by hand.

## Decision records

An ADR in `apps/docs/src/content/docs/adr/` is required for:

- a new dependency,
- a new port,
- a cross-cutting decision.

Copy the shape of an existing record (MADR format), number it next in sequence and set its status. Do not edit an accepted record to change history: supersede it with a new one.
