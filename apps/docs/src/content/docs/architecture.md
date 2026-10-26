---
title: Architecture
description: Components, ports and adapters, the plugin system and the data flow.
---

:::note
This is the target design. The workspace and the public SDK result type exist; the host app and domain logic are still being built.
:::

## Shape

fpving is a local web app: a Node server with SQLite on the user's machine and a React UI in the browser. It runs the same on macOS, Windows and Linux. See [ADR 0002](../adr/0002-local-web-app-over-desktop-shell/).

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

Zod, React, Fastify and dev tooling are not wrapped: they are framework or type-system level and swapping them has no value.

## Plugin system

Plugins supply all store support and run in worker threads. The host owns the browser, HTTP client, rate limits and timeouts. See [Writing a plugin](../writing-a-plugin/) and ADRs [0003](../adr/0003-store-support-via-plugins-only/) and [0004](../adr/0004-worker-thread-plugin-isolation/).

## Data flow

1. **Add product.** A pasted URL resolves to the plugin for its domain, which fetches the listing. A product, a listing and a first price snapshot are stored.
2. **Assisted match.** Extract the product identity from the title, search every other plugin that supports search, prefilter by model number and token similarity, then have the LLM judge each candidate as same, variant or different. Candidates wait in a review queue.
3. **Scan.** On each interval, group listings by plugin, fetch each, append a price snapshot and record a scan run.
4. **Alert evaluation.** A pure function takes the price history, the new snapshot, the product's listings, exchange rates and settings, and returns alerts for a price drop, back in stock or a new cheapest listing. Alerts are stored, then sent through the notifier.

## Money

Money is `{ amountMinor, currency }`: integer minor units plus an ISO 4217 code, never floats. Snapshots store store-native amounts only and conversion happens at read time. See [ADR 0006](../adr/0006-store-native-money-snapshots-and-read-time-fx/).

## Errors

Domain operations return `Result<T, E>`, a plain discriminated union. Exceptions are for real bugs and are never swallowed. The plugin error taxonomy is `not_found`, `blocked`, `parse_failed`, `timeout`, `network` and `unsupported_ship_to`. The `Result` type is available today in the [API reference](../api/fpving/plugin-sdk/).
