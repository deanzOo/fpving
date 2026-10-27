---
title: Contributing
description: How to set up, what the gates are, and when a decision record is required.
---

The full guide is [CONTRIBUTING.md](https://github.com/deanzoo/fpving/blob/main/CONTRIBUTING.md). A summary:

## Setup

1. Install Node 24 (`nvm install` reads `.nvmrc`) and enable corepack.
2. `pnpm install`
3. `pnpm verify` is the local gate: it runs the build (which typechecks), lint, tests with the coverage gate, the docs build, duplication, unused-code and license checks. CI also runs gitleaks, osv-scanner, commitlint and the lychee link check.
4. `pnpm worktree:init` writes this worktree's `.env` from `.env.example`: `PORT` is `4000 + fnv1a(absolute worktree path) % 1000` and `DATA_DIR` is the absolute path `<worktree path>/.data/<worktree directory name>`; the app rejects a relative `DATA_DIR`. It never overwrites an existing `.env` and exits 0 when one exists. A per-worktree Playwright profile and logs are planned, not built: they arrive with the E2E suite. See [ADR 0015](../adr/0015-per-worktree-env-and-port/).
5. `pnpm docs:dev` serves this site locally. Run `pnpm test` once first so the behaviour spec page can be generated.

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
