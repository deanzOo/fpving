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
- Type checking of mutants: with or without `@stryker-mutator/typescript-checker`, which rejects a mutant that does not compile before any test runs. Measured on the first run: without it, 1273 mutants, 1180 killed, 79 survived, score 93.7, about two minutes on eight cores. With it, 626 mutants never compile; of the rest 589 are killed and 58 survive, score 91.0, about eleven minutes. Without the checker the tests get credit for mutants `tsc` already rejects, which inflates the score, most for the plugin SDK (89.0 against 83.1). Chosen: the checker, so the gate measures what only the tests catch. It is also Apache-2.0.
- Where it runs: on every pull request, or nightly. Chosen: nightly on `main`. A full run takes about eleven minutes locally and longer on a CI runner, it adds nothing a reviewer must act on before merging, and the score moves only when tests or core code change.

## Decision outcome

`pnpm mutation` runs `stryker run` with `stryker.config.json`. The checker type checks each mutant against `tsconfig.tools.json`, which already covers both packages' sources and tests. It mutates `packages/core/src` and `packages/plugin-sdk/src`, minus what the coverage gate also leaves out: the package entry files, `core/src/testing`, `plugin-sdk/src/contract/index.ts` and `plugin-sdk/src/contract/check.ts`. Core's `eval/` folder is outside `src` and is not mutated. All exclusions live in `stryker.config.json`.

Thresholds: `break` 85, so a score below 85 fails the run; `low` 85 and `high` 95 colour the report. The first runs scored 91.0 to 91.5, depending on whether four core mutants time out or survive: core 93.2 to 93.7, plugin SDK 83.1. The gate is on the total, so the plugin SDK can sit below 85 while core carries it; its survivors are the first to kill. The plan is to raise `break` as survivors are killed, towards `high`.

The nightly workflow's `mutation` job runs on `main` only, with no secrets and no Stryker dashboard, and uploads the HTML report as the `mutation-report` artifact, kept seven days, even when the run fails. It is not part of `pnpm verify`.

Equivalent mutants, changes no test can tell apart from the original, are not suppressed in code: `// Stryker disable` comments are banned by lint, like coverage-ignore and `eslint-disable` comments. A genuinely equivalent mutant is excluded in `stryker.config.json` with a one-line reason and is reviewed like any other exclusion. There are none today.

## Consequences

- Good: the suite's assertions, not just its reach, are measured, and a drop below 85 shows up within a day.
- Good: no new test config to keep in step; the Stryker run uses the same projects as `pnpm test`.
- Bad: a regression in the score is found after merge, not before.
- Bad: the plugin SDK's `runStorePluginContract` registers its suite while Vitest collects tests, so emptying it removes tests rather than failing one, and its mutants survive.
- Bad: the checker makes a run about five times slower, and both the local run and the nightly job pay for it.
