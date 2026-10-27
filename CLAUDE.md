# fpving: rules for AI agents

Local-first, AGPL-3.0 pnpm monorepo that watches FPV gear prices. Human guide: CONTRIBUTING.md.

## Layout
- `apps/fpving` host app. `packages/core` domain. `packages/plugin-sdk` public SDK.
- Every runtime dependency sits behind a domain-defined port. Tests use in-memory fakes. Zod, React, Fastify and dev tooling are not wrapped.
- Store support is plugins only. No store plugins in this repo.

## Hard rules
- Node 24, pnpm via `packageManager`. Run `pnpm verify` before any push.
- TypeScript strictest. No `any`, no `as` (except `as const`), no `!`, no `@ts-*`, no `eslint-disable`, no coverage-ignore comments (`v8`/`c8`/`istanbul ignore`), no magic numbers or strings. Magic numbers are lint-enforced; magic strings are a review rule (use `as const` objects). Formatting is ESLint-enforced (`@stylistic`), no Prettier. `unknown` only at a trust boundary.
- Derive types with `z.infer` or `typeof`. No hand-written parallel types. Enums are `as const` objects.
- Money is `{ amountMinor: int, currency }`, never floats.
- Domain errors are `Result<T, E>`. No swallowed catches.
- No narrative comments. One line max, only when unavoidable. TSDoc on every exported symbol in `packages/core/src` and `packages/plugin-sdk/src` (lint-enforced).
- YAGNI. Surgical edits. Out-of-scope findings become issues, not drive-by fixes.

## Tests
- TDD: failing test first. Names read as requirements: `describe(feature) / it(behaviour sentence)`.
- 100% lines, branches, functions, statements. Exclusions in `vitest.config.ts` only.
- Integration tests use a real SQLite per test. Tests always use temp DBs.

## Bug protocol
Write the missing failing test, scan the codebase for the same bug class, fix every instance with tests.

## Worktree and env isolation
- One worktree per branch. Run `pnpm worktree:init` once per worktree: it writes `.env` from `.env.example` with `PORT=4000 + fnv1a(absolute worktree path) % 1000` and `DATA_DIR=.data/<worktree dir name>`, and never overwrites an existing `.env`. A hash collision between two worktrees means editing `PORT` by hand. Config is parsed by `apps/fpving/src/config/env.ts` (`PORT`, `DATA_DIR`, optional `ANTHROPIC_API_KEY`, `LOG_LEVEL`); error text never contains the key. Planned, not built: a per-worktree Playwright profile and logs, which arrive with the E2E suite.
- Never share a DB or port across worktrees. Never commit `.env` or `.data`.

## Commits and PRs
- Conventional Commits. Types: feat fix perf refactor test docs build ci chore revert. Scopes: core plugin-sdk plugins matcher pricing alerts scheduler db ui api ci deps. Source: `tools/commit-rules.ts`.
- Subject at most 72, lowercase start, no period. Body lines at most 100.
- PRs only, squash merge, never push `main`. PR title uses the same rules.
- Actions pinned by full SHA. No `pull_request_target`. PR CI needs zero secrets.
- Never commit or link process docs such as specs and plans.

## Docs
Site in `apps/docs` (Starlight). Behaviour changes update the relevant guide. A new dependency, port or cross-cutting decision adds an ADR in `apps/docs/src/content/docs/adr/` (MADR, next number; supersede, never rewrite). Every exported symbol in `packages/core/src` and `packages/plugin-sdk/src` needs TSDoc (lint-enforced); the API reference is generated from it. A JSDoc block is allowed only directly before an `export` or on a member of an exported declaration. The behaviour spec page is generated from test names (sentence-case describe names; `*.internal.test.ts` files are left out); do not edit it. `pnpm docs:dev` previews the site (run `pnpm test` once first).
