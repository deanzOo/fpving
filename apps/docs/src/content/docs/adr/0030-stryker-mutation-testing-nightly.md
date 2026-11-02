---
title: "0030. Stryker mutation testing, nightly"
description: How core and the plugin SDK are mutation tested, the score gate and why it runs nightly.
---

- Status: Accepted
- Date: 2026-11-02

## Context and problem statement

The 100% coverage gate proves every line of core and the plugin SDK runs under a test, not that a test would fail if the line were wrong. Mutation testing changes the code one small edit at a time (a flipped comparison, an emptied string, a removed call) and checks that some test fails. A mutant that no test catches marks an assertion the suite is missing.

## Considered options

- Tool: Stryker with `@stryker-mutator/vitest-runner`, the maintained JavaScript mutation tool, which runs the existing Vitest projects and measures per-test coverage so each mutant runs only the tests that reach it. Both packages are Apache-2.0. No other JavaScript tool runs Vitest.
- Test config: a second Vitest config listing the core and plugin SDK tests, or a thin `stryker.vitest.config.ts` that imports the root `vitest.config.ts` and keeps only its `core` and `plugin-sdk` projects. Chosen: the thin one. The runner has no project filter, and with `vitest.related` the UI's browser-mode tests, which import core, would be picked up; Stryker does not support browser mode. The derived config cannot drift from the root one.
- Type checking of mutants: with or without `@stryker-mutator/typescript-checker`, which rejects a mutant that does not compile before any test runs. Measured on the first run: without it, 1273 mutants, 1180 killed, 79 survived, score 93.7, about two minutes on eight cores. With it, 626 mutants never compile; of the rest 589 are killed and 58 survive, score 91.0, about 12 minutes. Without the checker the tests get credit for mutants `tsc` already rejects, which inflates the score, most for the plugin SDK (89.0 against 83.1). Chosen: the checker, so the gate measures what only the tests catch. It is also Apache-2.0.
- Where it runs: on every pull request, or nightly. Chosen: nightly on `main`. A full run takes about 12 minutes on eight cores and longer on a CI runner, it adds nothing a reviewer must act on before merging, and the score moves only when tests or core code change.

## Decision outcome

`pnpm mutation` runs `pnpm build`, then `stryker run` with `stryker.config.json`. The build comes first because `tsconfig.tools.json` takes in `tools/`, which imports the app's built `dist`, and the checker fails on a fresh checkout without it. The checker type checks each mutant against `tsconfig.tools.json`, which already covers both packages' sources and tests. It mutates `packages/core/src` and `packages/plugin-sdk/src`, minus what the coverage gate also leaves out: the package entry files, `core/src/testing`, `plugin-sdk/src/contract/index.ts` and `plugin-sdk/src/contract/check.ts`. It also leaves out `plugin-sdk/src/contract/run-contract.ts`, for the same reason `core/src/testing` holds the repository and store gateway contract suites: these files only register a Vitest suite while tests are collected, so a mutant there removes tests instead of failing one, and only a nested Vitest run that knows Stryker's internals could catch it. The checks they register live in `check-contract.ts`, which is mutated. Core's `eval/` folder is outside `src` and is not mutated. All exclusions live in `stryker.config.json`.

Thresholds: `break` 85, so a score below 85 fails the run; `low` 85 and `high` 95 colour the report. The gate is on the total score; there is no per-package floor. The first full run scored 91.0, with the plugin SDK at 83.1, and its schema and contract kit survivors were killed first. After that the run scores 94.9: core 95.6, plugin SDK 92.4. The plan is to raise `break` as survivors are killed, towards `high`.

`timeoutMS` is 15000. With Stryker's default of 5000, test runners starved of CPU by the checker reported slow survivors as timeouts, which count as detected and inflated the score. No mutant here loops forever, so a longer wait costs little.

The nightly workflow's `mutation` job runs on `main` only, with no secrets and no Stryker dashboard, and uploads the HTML report as the `mutation-report` artifact, kept seven days, even when the run fails. It is not part of `pnpm verify`.

Equivalent mutants, changes no test can tell apart from the original, are never suppressed. `// Stryker disable` comments are banned by lint, like coverage-ignore and `eslint-disable` comments, and Stryker's JSON config holds no comments and can only exclude whole files, so there is no per-mutant exclusion either. An equivalent mutant almost always marks a redundant condition: the fix is to simplify the code until the mutant no longer exists, with the existing tests green, after showing from the types or the call sites why the condition cannot change the result. The first run looked like it had four: the known-shipping filter in `cheapestBy`, the incoming-id check on the evaluated history, and the backoff and empty-rows conditions in the scan. The first three were removed this way. The empty-rows condition was not equivalent after all. When an older snapshot shares the fetched one's observation time, the latest-per-listing tie rule can hide the fetched snapshot. So the condition stays, and a test now kills its mutant. A mutant that is equivalent but cannot be simplified away stays a survivor and counts against the gate.

## Consequences

- Good: the suite's assertions, not just its reach, are measured, and a drop below 85 shows up within a day.
- Good: no new test config to keep in step; the Stryker run uses the same projects as `pnpm test`.
- Bad: a regression in the score is found after merge, not before.
- Bad: `runStorePluginContract` and the core contract suites are not mutated; a broken registrar shows up only as missing tests.
- Bad: the checker makes a run about five times slower, and both the local run and the nightly job pay for it.
