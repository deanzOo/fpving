---
title: Contributing
description: How to set up, what the gates are, and when a decision record is required.
---

The full guide is [CONTRIBUTING.md](https://github.com/deanzoo/fpving/blob/main/CONTRIBUTING.md). A summary:

## Setup

1. Install Node 24 (`nvm install` reads `.nvmrc`) and enable corepack.
2. `pnpm install`
3. `pnpm verify` runs typecheck, lint, tests with the coverage gate, build, the docs build, duplication, unused-code and license checks.
4. `pnpm docs:dev` serves this site locally. Run `pnpm test` once first so the behaviour spec page can be generated.

## Rules in brief

- Write a failing test before the implementation. Test names read as requirements.
- Coverage is a hard 100% gate on lines, branches, functions and statements.
- Strict TypeScript: no `any`, no `as` except `as const`, no `!`, no `@ts-*`, no `eslint-disable`.
- No narrative comments. Public exports of `@fpving/core` and `@fpving/plugin-sdk` carry TSDoc, which lint enforces.
- Conventional Commits, squash merged through pull requests.

## Docs

Behaviour changes update the relevant guide. The API reference is generated from TSDoc and the behaviour specification from test names, so neither is edited by hand.

## Decision records

An ADR in `apps/docs/src/content/docs/adr/` is required for:

- a new dependency,
- a new port,
- a cross-cutting decision.

Copy the shape of an existing record (MADR format), number it next in sequence and set its status. Do not edit an accepted record to change history: supersede it with a new one.
