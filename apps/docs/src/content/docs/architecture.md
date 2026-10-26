---
title: Architecture
description: Components, ports and adapters, the plugin system and the data flow.
---

:::note
This is the target design. The workspace, the public plugin SDK contract (types, schemas, error taxonomy and contract test kit), core pricing, and the core entities and ports exist; the host app, the adapters and the rest of the domain logic are still being built.
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

`BrowserDriver`, `HttpClient`, `Clock` and `Logger` are defined in `@fpving/plugin-sdk` as the capabilities the host hands to plugins; `@fpving/core` re-exports `Clock` and `Logger`. `LlmJudge`, `CurrencyRates`, `Notifier`, `Repository`, `Scheduler`, `IdGenerator` and `DebugSink` are defined in `@fpving/core`. No default adapter is built yet. `IdGenerator` and `DebugSink` are explained in [ADR 0013](../adr/0013-id-generator-and-debug-sink-ports/).

`Repository` groups one repository per aggregate: products, listings, price snapshots, match candidates, the LLM verdict cache, alerts, scan runs, exchange rates, plugin health and settings. Expected refusals, such as a url that is already tracked, resolve to a `Result`. Every implementation must pass the shared repository contract suite in `packages/core/test/repository-contract.ts`; core runs it against an in-memory fake.

Zod, React, Fastify and dev tooling are not wrapped: they are framework or type-system level and swapping them has no value.

## Plugin system

Plugins supply all store support and are designed to run in worker threads. The host will own the browser, HTTP client, rate limits and timeouts. Everything that crosses the host and plugin boundary is plain data that survives `structuredClone`, so URLs are absolute http(s) strings. See [Writing a plugin](../writing-a-plugin/) and ADRs [0003](../adr/0003-store-support-via-plugins-only/) and [0004](../adr/0004-worker-thread-plugin-isolation/).

## Data flow

1. **Add product.** A pasted URL resolves to the plugin for its domain, which fetches the listing. A product, a listing and a first price snapshot are stored.
2. **Assisted match.** Extract the product identity from the title, search every other plugin that supports search, prefilter by model number and token similarity, then have the LLM judge each candidate as same, variant or different. Candidates wait in a review queue.
3. **Scan.** On each interval, group listings by plugin, fetch each, append a price snapshot and record a scan run.
4. **Alert evaluation.** `evaluate` in `packages/core` is a pure function of the listing's earlier snapshots, the new snapshot, the product's listings with their newest snapshots, exchange rates and settings. It returns alert drafts and the product's cheapest listing id; the scan, once wired, assigns ids, stores the alerts and the cheapest id, and sends them through the notifier.
   - **Price drop.** The new item price, in the store's own currency and for the same destination, is in stock, lower than every in-stock snapshot of the last 30 days and at least `priceDropMinBasisPoints` below their lowest. Shipping and exchange rates play no part, and a listing with no earlier snapshot in the window never alerts.
   - **Back in stock.** The previous snapshot for the same destination was out of stock and the new one is in stock.
   - **New cheapest.** Among active, in-stock listings whose latest snapshot was quoted for the user's ship-to country, with known shipping and a computable landed cost, the cheapest differs from the previously stored cheapest. Ties go to the earlier added listing, then the lower id. Costs are compared unrounded. When no listing qualifies the stored cheapest is kept, and the first scan, with no stored cheapest, never alerts.

## Money

Money is `{ amountMinor, currency }`: integer minor units plus an ISO 4217 code, never floats. `CURRENCY_MINOR_UNITS` in the SDK gives each currency's decimal places. Snapshots store store-native amounts only and conversion happens at read time. See [ADR 0006](../adr/0006-store-native-money-snapshots-and-read-time-fx/).

## Errors

Domain operations return `Result<T, E>`, a plain discriminated union. Exceptions are for real bugs and are never swallowed. The plugin error taxonomy, `StoreErrorKind` in the SDK, is `not_found`, `blocked`, `parse_failed`, `timeout`, `network` and `unsupported_ship_to`. It and `Result` are in the [API reference](../api/fpving/plugin-sdk/).
