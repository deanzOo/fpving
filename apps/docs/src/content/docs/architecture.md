---
title: Architecture
description: Components, ports and adapters, the plugin system and the data flow.
---

:::note
This is the target design. The workspace, the public plugin SDK contract (types, schemas, error taxonomy and contract test kit), core pricing, the core entities and ports, the alert evaluator, the add-product and add-listing use cases, assisted matching, the scan use case and the scan schedule policy exist; the SQLite and Anthropic adapters and the matcher eval runner exist; the host app, the timer adapter, the plugin host, the other adapters and the rest of the domain logic are still being built.
:::

## Shape

fpving is designed as a local web app: a Node server with SQLite on the user's machine and a React UI in the browser. It is meant to run the same on macOS, Windows and Linux. See [ADR 0002](../adr/0002-local-web-app-over-desktop-shell/).

```text
browser UI (localhost)
  Watchlist, Product detail, Match review, Alerts, Settings, Plugins
        | HTTP JSON
Node server
  api         thin Fastify routes, logic lives in core
  scheduler   interval scans, catch-up on boot
  plugins     loader, manifest validation, worker-thread host
  matcher     identity extraction, search, prefilter, LLM judge
  pricing     FX conversion, shipping, import tax, landed cost
  alerts      pure evaluator, then Notifier and stored alerts
  db          SQLite behind Repository
```

## Monorepo

| Path | Role |
| --- | --- |
| `apps/fpving` | Host app: server and UI. |
| `packages/core` | Domain: products, listings, pricing, alerts, matcher. |
| `packages/plugin-sdk` | Public SDK: types, manifest schema, error taxonomy, contract test kit. |
| `apps/docs` | This site. |

## Ports and adapters

Every runtime or integration dependency sits behind an interface the domain defines. Tests use in-memory fakes of the same interfaces. See [ADR 0005](../adr/0005-ports-and-adapters-for-dependencies/).

| Port | Default adapter |
| --- | --- |
| `BrowserDriver` | Playwright |
| `LlmJudge` | Anthropic SDK |
| `CurrencyRates` | Public FX API |
| `Notifier` | OS-native notifications |
| `Repository` | SQLite |
| `HttpClient` | Node fetch |
| `Clock` | System clock |
| `Scheduler` | In-process timer |
| `Logger` | Structured logger |
| `IdGenerator` | Random UUIDs |
| `DebugSink` | Files under `.data/debug/<plugin>/` |
| `StoreGateway` | The plugin host |

`BrowserDriver`, `HttpClient`, `Clock` and `Logger` are defined in `@fpving/plugin-sdk` as the capabilities the host hands to plugins; `@fpving/core` re-exports all four. `LlmJudge`, `CurrencyRates`, `Notifier`, `Repository`, `Scheduler`, `IdGenerator`, `DebugSink` and `StoreGateway` are defined in `@fpving/core`. Only `Repository` and `LlmJudge` have adapters so far. `IdGenerator` and `DebugSink` are explained in [ADR 0013](../adr/0013-id-generator-and-debug-sink-ports/). `StoreGateway` is how core reaches the store plugins: the declared domains, the plugin for a URL, fetch and search. See [ADR 0014](../adr/0014-store-gateway-port/).

`Repository` groups one repository per aggregate: products, listings, price snapshots, match candidates, the LLM verdict cache, alerts, scan runs, exchange rates, plugin health and settings. Expected refusals, such as a url that is already tracked, resolve to a `Result`. Ordering is part of the contract: pending candidates come highest similarity first, ties by id, and the latest exchange rates are the last table saved, whatever its date. Every implementation must pass the shared repository contract suite, `describeRepositoryContract` from `@fpving/core/testing`, which an adapter runs against its own repository; core runs it against an in-memory fake. Vitest is an optional peer dependency needed only by that entry, as it is for `@fpving/plugin-sdk/contract`.

The SQLite adapter in `apps/fpving/src/adapters/sqlite` passes that suite against a real database file. It uses `better-sqlite3` and Drizzle, enforces foreign keys, and runs each method in one transaction. `migrate` backs up an existing database before applying pending migrations. See [ADR 0016](../adr/0016-sqlite-persistence-with-better-sqlite3-and-drizzle/).

The Anthropic adapter in `apps/fpving/src/adapters/anthropic` implements `LlmJudge` with `claude-haiku-5-5` at low effort and a JSON schema output built from the core Zod schemas. Its compare prompt lists the labelling rules from the matcher eval's `pairs.json`. It keeps at most four calls in flight, maps refusals, cut-off answers, invalid output and SDK errors to `LlmError`s, and logs each failure without the API key. See [ADR 0017](../adr/0017-anthropic-sdk-and-haiku-for-the-llm-judge/). Nothing wires it into the app yet.

Zod, React, Fastify and dev tooling are not wrapped: they are framework or type-system level and swapping them has no value.

## Plugin system

Plugins supply all store support and are designed to run in worker threads. The host will own the browser, HTTP client, rate limits and timeouts. Everything that crosses the host and plugin boundary is plain data that survives `structuredClone`, so URLs are absolute http(s) strings. See [Writing a plugin](../writing-a-plugin/) and ADRs [0003](../adr/0003-store-support-via-plugins-only/) and [0004](../adr/0004-worker-thread-plugin-isolation/).

## Data flow

1. **Add product.** `addProduct` in `packages/core` normalizes the pasted URL with `normalizeListingUrl`, resolves the plugin that declares its host and fetches the listing through `StoreGateway`. It stores a product named after the listing title, a `manual` listing and a first snapshot quoted for the ship-to country, all or nothing. `addListing` does the same for an existing product, storing the listing and its first snapshot together.
   - **Normalization.** The scheme and host are lowercased; the username and password, the fragment, the default port and tracking parameters (`utm_*`, `aff_*`, `gclid`, `fbclid`, `msclkid`, `spm`, `scm`) are dropped; the remaining parameters are sorted; trailing slashes leave the path, except the root `/`. A `www.` or `m.` subdomain is stripped only when the host left over is a declared plugin domain.
   - **Outcomes.** A URL a listing already tracks is not fetched and yields `already_tracked` with that listing, also when another add stores it during the fetch. Otherwise the result is `invalid_url`, `no_plugin_for_domain` with the host, `fetch_failed` with the store error, or, for `addListing`, `product_not_found` for an unknown product. An `ok` result returns what was stored, so the host can start assisted matching.
2. **Assisted match.** `findMatches` in `packages/core` matches from the product's earliest manual listing. The LLM extracts its brand, model and variant attributes, and every store that supports search, except the source's, is searched in parallel for the brand and model. Without an identity, the stores are searched for the source title instead. A failed search is reported and does not stop the others. `findMatches` and `rejudgeUnjudged` refuse with `product_not_found` for an unknown product and `no_source_listing` for one without a manual listing; `findMatches` also yields `already_suggested` when another run suggested one of the URLs between the check and the save. Use cases never pass a repository error kind (`not_found`, `duplicate_url`) on to the caller.
   - **Prefilter.** Result URLs are normalized like pasted ones. Invalid URLs, repeats, URLs a listing tracks and URLs already suggested for the product, rejected ones included, are dropped. The rest are scored from 0 to 1: the share of the identity's model numbers (words holding a digit, such as `2207` or `6s`) found in the title weighs 0.6, the share of all its words found 0.4, so long titles are not penalized. Words keep dots and slashes (`5.8G`, `1/1.8`) and drop inner hyphens (`R-Line` matches `RLine`). The five most similar per store are kept.
   - **Judge.** The LLM judges each candidate against the source title as same, variant or different with a one-line reason. Verdicts are cached by source and candidate URL. When the LLM fails, the candidate is saved `unjudged` and ranked by similarity; `rejudgeUnjudged` judges a product's unjudged candidates again. Nothing in core calls it: like `findMatches`, the host triggers it, for example when the user opens the review list or the LLM becomes available again.
   - **Review.** Candidates wait as `pending`. `acceptCandidate` fetches the candidate's page and stores a `matched` listing with its first snapshot while marking the candidate accepted, all or nothing. `rejectCandidate` marks it rejected, so its URL is never suggested for the product again. Either refuses a candidate that is not pending with `not_pending`; the repository enforces this, so a candidate decided during an accept stays decided and nothing is stored.
   - **Eval.** `packages/core/eval/pairs.json` holds its labelling rules and labelled title pairs (same, variant, different), including clones, bundles, colour, voltage and analog versus digital variants; `scoreMatcher` scores verdicts against them per label and overall. `pnpm eval:matcher` runs every pair through the Anthropic adapter and fails below 90% overall accuracy, printing each miss and the accuracy per label; it skips when `ANTHROPIC_API_KEY` is not set. The nightly workflow runs it when the repository has that secret.
3. **Scan.** `scanListings` in `packages/core` fetches the active and stale listings of unarchived products through `StoreGateway`. Plugins run in parallel and each plugin's listings one at a time; per-domain rate limits, timeouts and saving the raw page of a `parse_failed` fetch belong to the gateway. `startScheduler` runs it on a schedule through the `Scheduler` port; the real timer adapter and the app wiring are not built yet.
   - **Schedule.** A scan runs every `scanIntervalHours`, read from the settings at start, so a change applies after a restart. On boot it catches up with one scan when the last scan started at least one interval ago or never ran; after weeks offline that is still a single scan, not one per missed interval. The boot scan runs in the background. The timer is anchored to the last scan, not to the boot: the first tick comes when that scan's interval is up (one interval after the boot scan when it was overdue), and a scan on demand pushes the next tick a full interval out, so the schedule never fires right after a manual scan. The `Scheduler` port takes the first delay for this. A boot where every plugin is backing off still counts as a scan, because blocked runs are recorded, so the next boot within the interval does not catch up.
   - **Exchange rates.** Each scan first refreshes the stored rates when none exist or more than a day has passed since the start (UTC) of their `fetchedOn` date. A fetch that returns the date already stored is not saved again and is reported as `unchanged`, which avoids duplicates at weekends. A failed fetch is logged and the scan runs on the last rates.
   - **No overlap.** Scans are single-flight. A tick or a manual `scanNow` that arrives while a scan runs joins it and gets its report. A scan that throws is logged and the schedule keeps ticking; `scanNow` rejects for its caller. `stop()` cancels the schedule and resolves once a running scan has finished, so the host can close the database; after it `scanNow` starts nothing and resolves to a `stopped` error.
   - **Snapshots.** Each successful fetch appends a snapshot quoted for the saved ship-to country.
   - **Listing health.** A success makes the listing active and resets its streaks. Three failures in a row, `blocked` aside, make it `stale`; two `not_found` results in a row make it `gone`, and a gone listing is never fetched again.
   - **Plugin backoff.** `blocked` is about the plugin, not the listing, which keeps its status and streaks. It stops that plugin's scan and backs it off for 15 minutes, doubling with each consecutive block up to 24 hours. A plugin still backing off is skipped. Any success clears the backoff.
   - **Scan runs.** Each plugin that has listings to scan records one run, and a plugin without any records none: `blocked` when it was skipped or blocked, else `ok` when any fetch succeeded, else `failed` with the last store error.
   - **Alerts.** Each product's fetched listings are then evaluated one at a time, against their snapshots of the last 30 days and the latest stored exchange rates. The cheapest listing carries from one evaluation to the next, so a scan raises at most one new cheapest alert per product, and is stored on the product when it changed. A product with a listing that went stale or gone but no successful fetch has only its cheapest recomputed, and a gone cheapest is cleared when no other listing qualifies. Alerts are stored, then sent through the notifier; one the notifier cannot show stays stored and is logged.
4. **Alert evaluation.** `evaluate` in `packages/core` is a pure function of the listing's earlier snapshots, the new snapshot, the product's listings with their newest snapshots, exchange rates and settings. It returns alert drafts and the product's cheapest listing id; the scan assigns ids, stores the alerts and the cheapest id, and sends them through the notifier.
   - **Price drop.** The new item price, in the store's own currency and for the same destination, is in stock, lower than every in-stock snapshot of the last 30 days and at least `priceDropMinBasisPoints` below their lowest. Shipping and exchange rates play no part, and a listing with no earlier snapshot in the window never alerts.
   - **Back in stock.** The previous snapshot for the same destination was out of stock and the new one is in stock.
   - **New cheapest.** Among active, in-stock listings whose latest snapshot was quoted for the user's ship-to country, with known shipping and a computable landed cost, the cheapest differs from the previously stored cheapest. Ties go to the earlier added listing, then the lower id. Costs are compared unrounded. When no listing qualifies, or no exchange rates were ever fetched, the stored cheapest is kept unless that listing is gone, when it is cleared, and the first scan, with no stored cheapest, never alerts.

## Money

Money is `{ amountMinor, currency }`: integer minor units plus an ISO 4217 code, never floats. `CURRENCY_MINOR_UNITS` in the SDK gives each currency's decimal places. Snapshots store store-native amounts only and conversion happens at read time. See [ADR 0006](../adr/0006-store-native-money-snapshots-and-read-time-fx/).

## Errors

Domain operations return `Result<T, E>`, a plain discriminated union. Exceptions are for real bugs and are never swallowed. The plugin error taxonomy, `StoreErrorKind` in the SDK, is `not_found`, `blocked`, `parse_failed`, `timeout`, `network` and `unsupported_ship_to`. It and `Result` are in the [API reference](../api/fpving/plugin-sdk/).
