---
title: "0029. In-process E2E on Vitest and the Playwright library"
description: How the end-to-end journey boots the app, drives the browser and gets the built UI.
---

- Status: Accepted
- Date: 2026-11-01

## Context and problem statement

Unit and integration tests cover core, the plugin host, the API and each UI screen against a scripted client, but nothing drives the built UI against the running app. One journey must: add a product, review and accept a judged match, scan, lower the price, and see the price drop alert. It has to run on the three-OS CI matrix, inside `pnpm test`, without an API key, OS notifications or network access, and without flaking.

## Considered options

- Boot: spawn `dist/main.js` as a child process, or call `startApp` in the test process. Chosen: in process. The fake LLM judge, fake exchange rates and a recording notifier, exported from `@fpving/core/testing`, go in through the existing `AppPorts` overrides, so the test needs no production hook and reads what the notifier received directly. HTTP is the real client, allowed to reach the loopback fixture store; plugins run on real worker threads from source; the scan scheduler and the browser driver are the real ones.
- Runner: `@playwright/test`, or a Vitest project using the `playwright` library that is already a dependency. Chosen: the `e2e` Vitest project, so it shares the reporters, the behaviour spec and `pnpm test`, and adds no dependency. It has no web-first `expect`, so every wait is a locator `waitFor` on the UI's own text, never a sleep.
- UI: a `uiRoot` override in `startApp`, or building into `apps/ui/dist/web`. Chosen: the project's global setup runs Vite's `build` with the UI's own config, the same output `pnpm build` writes, so production code is unchanged and a fresh checkout needs no build first.
- Stores: the fixture plugin alone, or a second fixture store. Matching never searches the source listing's own store, and the fixture plugin quotes unknown shipping, which has no landed cost. Chosen: a fetch-only `source-shop` fixture plugin with known shipping holds the watched listing, and the fixture plugin's search supplies the candidate.

## Decision outcome

`apps/fpving/test/e2e` holds the journey and the global setup; the `app` project excludes it. The journey is one `describe` whose steps are separate tests over one app, so each requirement, including the absence of an alert, is a line of the behaviour spec. The journey gets its own temp `DATA_DIR` with a `plugins.json`, a free port, its own local store server and a fresh Chromium profile in a temp folder. Teardown closes the browser, shuts the app down, closes the store server and removes the temp folder, every step even when one fails. A `console.error` or warning, a page error or a CSP violation, which Chromium reports on the console, on any page of the browser context fails the step. The project has its own generous timeouts. `FPVING_E2E_HEADED=1` opens a visible browser for debugging.

The absence checks are built so that the bug they guard against turns them red. The watched listing is scanned once before the match is accepted, so it is the stored cheapest and a cheaper match with unknown shipping would raise `new_cheapest` if unknown shipping counted as free. The ship-to country is changed on Settings before a scan, so every listing gets a first snapshot for the new destination and a price drop on empty history would show. "No alerts" is read from a fresh page load with the Alerts screen's unread filter, which shares its query with the nav badge, so stale data cannot pass it.

The 100% coverage gate is earned without the journey: `pnpm test:coverage` runs every project except `e2e`, and `verify` and the CI check matrix run `pnpm test:e2e` after it. Under a `--project` filter Vitest matches `coverage.include` against each project's root, so the node projects scan their tests from `dir` and keep the repository root. `pnpm test` runs everything and writes the behaviour spec with the journey; `pnpm test:e2e` keeps only the default reporter so it does not overwrite that spec with the journey alone.

## Consequences

- Good: no production change; the journey goes through the same composition root as the real app.
- Good: it runs wherever `pnpm test` runs, with the Chromium the UI tests already install.
- Bad: each run builds the UI first, about a second, and the build empties `apps/ui/dist/web` before writing it. A running `pnpm dev`, `node dist/main.js` or `docs:dev` that serves that folder briefly loses its files while tests run.
- Bad: in watch mode the global setup runs once per session, so the journey reruns against the UI as it was built when the session started; restart Vitest after a UI change.
- Bad: `pnpm verify` builds the docs from the spec of the coverage run, which leaves the journey out; the CI docs job runs `pnpm test` and publishes it.
- Bad: in process, it does not cover the process entry point or signals; `run.test.ts` keeps covering those.
