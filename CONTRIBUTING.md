# Contributing

Thanks for helping. Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

1. Install Node 24 (`nvm install` reads `.nvmrc`).
2. Enable pnpm through corepack: `corepack enable`. The pinned version comes from `packageManager`.
3. `pnpm install`
4. `pnpm verify` runs typecheck, lint, tests with the 100% coverage gate, duplication and unused-code checks.

Run the full gate before every push. Commit hooks (lefthook) run eslint and gitleaks on staged files and commitlint on the message.

## Worktree workflow

Work on a branch in its own git worktree, never directly on `main`:

```sh
git worktree add .worktrees/my-change -b feat/my-change main
```

Each worktree gets its own port, SQLite file and Playwright profile so parallel branches cannot collide.

## Tests first

- Write a failing test before the implementation, for every feature and bug fix.
- Test names read as requirements: `describe("Price drop alert")` and `it("fires when ...")`.
- Coverage is a hard 100% gate on lines, branches, functions and statements. Exclusions live in `vitest.config.ts` only.

### Bug protocol

1. Write the missing failing test that reproduces the bug.
2. Scan the codebase for the same class of bug, not just the symptom.
3. Fix every instance, each with a test.

## Code rules

- No comments that narrate code. At most one line, only where the code is genuinely unclear. Public API docs use TSDoc.
- No `any`, no `as` assertions (except `as const`), no non-null `!`, no `@ts-ignore` or `@ts-expect-error`, no `eslint-disable`, no magic numbers or strings.
- Derive types from Zod schemas at boundaries. Enums are `as const` objects. Money is integer minor units plus a currency code.
- Domain errors are `Result` values. Do not swallow exceptions.

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
