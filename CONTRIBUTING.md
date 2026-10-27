# Contributing

Thanks for helping. Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

1. Install Node 24 (`nvm install` reads `.nvmrc`).
2. Enable pnpm through corepack: `corepack enable`. The pinned version comes from `packageManager`.
3. Install the `gitleaks` binary, which the pre-commit hook needs: `brew install gitleaks`, or download a build for Windows or Linux from <https://github.com/gitleaks/gitleaks/releases>.
4. `pnpm install`
5. `pnpm verify` is the local gate. It runs the build (which also typechecks), lint, tests with the 100% coverage gate, the docs build, duplication, unused-code and license checks. `pnpm typecheck` is a quick non-emitting check.

CI additionally runs gitleaks, osv-scanner, commitlint and the lychee link check, none of which are part of `verify`. To run the vulnerability scan locally, install the `osv-scanner` binary (`brew install osv-scanner`, or <https://github.com/google/osv-scanner/releases>) and run `pnpm audit:osv`; it needs network access.

Run `pnpm verify` before every push. Commit hooks (lefthook) run eslint and gitleaks on staged files and commitlint on the message.

## Worktree workflow

Work on a branch in its own git worktree, never directly on `main`:

```sh
git worktree add .worktrees/my-change -b feat/my-change main
```

Planned, not built yet: tooling that gives each worktree its own port, SQLite file and Playwright profile so parallel branches cannot collide. Until it exists there is no per-worktree isolation, so do not run two worktrees' servers or databases against the same port or file.

## Tests first

- Write a failing test before the implementation, for every feature and bug fix.
- Test names read as requirements: `describe("Price drop alert")` and `it("fires when ...")`. Describe names are sentence case, because they become headings in the behaviour specification.
- Name a test file `*.internal.test.ts` when it checks implementation detail rather than behaviour a user or plugin author relies on (test fakes, the shape of a public entry, wiring). The behaviour specification leaves those files out.
- Coverage is a hard 100% gate on lines, branches, functions and statements. Exclusions live in `vitest.config.ts` only.

### Bug protocol

1. Write the missing failing test that reproduces the bug.
2. Scan the codebase for the same class of bug, not just the symptom.
3. Fix every instance, each with a test.

## Code rules

- Formatting is ESLint-enforced through `@stylistic/eslint-plugin` (2-space indent, double quotes, semicolons, trailing commas, 120 columns). There is no Prettier. `pnpm lint --fix` fixes most of it.
- No comments that narrate code. At most one line, only where the code is genuinely unclear. Public API docs use TSDoc.
- No `any`, no `as` assertions (except `as const`), no non-null `!`, no `@ts-ignore` or `@ts-expect-error`, no `eslint-disable`, no coverage-ignore comments (`v8 ignore`, `c8 ignore`, `istanbul ignore`; exclusions live in `vitest.config.ts` only), no magic numbers. Lint enforces magic numbers. Magic strings are a review rule: use `as const` objects.
- Derive types from Zod schemas at boundaries. Enums are `as const` objects. Money is integer minor units plus a currency code.
- Domain errors are `Result` values. Do not swallow exceptions.

## Docs and decision records

The docs site lives in `apps/docs` (Starlight). Run `pnpm test` once, then `pnpm docs:dev` to preview it; `pnpm docs:build` builds it and `pnpm verify` includes that build.

- Behaviour changes update the relevant guide.
- Every exported symbol in `packages/core/src` and `packages/plugin-sdk/src` needs TSDoc. Lint enforces it and the API reference is generated from it. A JSDoc block is allowed only directly before an `export` or on a member of an exported declaration.
- The behaviour specification page is generated from test names. Do not edit it.
- An ADR is required for a new dependency, a new port, or a cross-cutting decision. Add it to `apps/docs/src/content/docs/adr/` in MADR format with the next number. Supersede an accepted ADR with a new one instead of rewriting it.

## Commits and pull requests

Commits and PR titles follow Conventional Commits: `type(scope): subject`.

- Types: feat, fix, perf, refactor, test, docs, build, ci, chore, revert.
- Scopes (optional): core, plugin-sdk, plugins, matcher, pricing, alerts, scheduler, db, ui, api, ci, deps.
- Subject: at most 72 characters, starts lowercase, no trailing period. Body lines at most 100 characters.

The lists come from `tools/commit-rules.ts`, which commitlint and the PR title check both use.

Pull requests are squash merged, so the PR title becomes the commit on `main`. `main` accepts changes only through pull requests with green checks and resolved conversations.

Labels are applied automatically from changed paths. Pull requests from forks do not get labels, because the labeler runs on `pull_request` and fork tokens are read-only.

Do not commit process notes or design drafts. Product docs and ADRs are public.

## Maintainers

Release PRs opened by release-please with the default `GITHUB_TOKEN` do not trigger CI. Add a `RELEASE_PLEASE_TOKEN` repository secret (a fine-grained PAT with contents and pull requests write) so release PRs run checks. Without it, release PRs need an owner bypass to merge.

Dependabot PRs skip the commit message check because its bodies exceed the line limit; the PR title check still gates the squash commit.
