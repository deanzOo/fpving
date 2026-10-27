---
title: "0018. Frankfurter, node-notifier and pino for the rates, notifier and logger adapters"
description: Which source and libraries implement the CurrencyRates, Notifier and Logger ports.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

Three more ports need real adapters: `CurrencyRates` (exchange rates for landed-cost conversion), `Notifier` (show an alert as a desktop notification on macOS, Windows and Linux) and `Logger` (a file log that never holds secrets). All three must return typed errors instead of throwing, and tests must not touch the network, the desktop or the real log directory.

## Considered options

Rates:

- Frankfurter (`https://api.frankfurter.dev/v1/latest`), the European Central Bank reference rates. Free, no key, JSON. Chosen.
- A keyed commercial API. Rejected: the project is bring-your-own-key only where it must be, and a rate needs no account.
- Scraping a bank page. Rejected: fragile for no gain.

Notifier:

- `node-notifier` 11 (MIT). Chosen. Maintained, one API over Notification Center, Windows toasts and `notify-send`, no install script.
- `toasted-notifier`, a fork. Rejected: no new release since 2025-06 and it adds `semver`, `shellwords` and `which`.
- Platform commands by hand (`osascript`, PowerShell, `notify-send`). Rejected: three code paths to quote and test.

Logger:

- `pino` 10 (MIT). Chosen, as asked: fast JSON lines to a file with a synchronous destination.

## Decision outcome

`HttpFxRates` (`createHttpFxRates`) fetches the latest ECB rates with an injected `fetch` and a ten second timeout. The table is based on EUR, the source's base, and core converts across currencies through the base. Rates for codes outside `CURRENCY_CODES` are dropped, and the result is validated with core `fxTableSchema`. A network failure, a non-2xx status, a body that is not JSON and a schema mismatch all resolve to `rates_unavailable` with a detail for the log. The ECB publishes once per working day, so `fetchedOn` can be a few days old over a weekend. `refreshRatesIfStale` never saves a fetched table older than, or dated the same as, the stored one, so a provider that regresses cannot overwrite newer rates.

`OsNotifier` (`createOsNotifier`) calls an injected backend; the real one wraps `node-notifier`'s callback. `node-notifier`'s callback error argument is not reliably `null`: on success it is an empty string (the command's stderr), `undefined` or `null` depending on the platform path, so any falsy value is success and a truthy one, a string being turned into an `Error`, is a failure. A rejected or throwing backend is a `notify_failed` result, and core keeps the alert either way. The trade-off: `node-notifier` bundles `terminal-notifier` (macOS), `SnoreToast` and `notifu` (Windows) as binaries inside the npm package. Nothing is downloaded at install time, but those executables ship with the dependency as unsigned third-party binaries, and the notifier modes were not exercised on real macOS, Windows or Linux hardware here, only through the injected backend, and its type declarations come from `@types/node-notifier` (written for v8; the call used here is unchanged). On Linux it needs `notify-send` (libnotify) on the path, otherwise the call fails and the result is `notify_failed`.

`PinoLogger` (`createPinoLogger`) writes JSON lines with ISO timestamps and string level labels to an injected file path, creating missing directories, at the level from `LOG_LEVEL`. The app passes `DATA_DIR/logs/fpving.log`. Pino's `redact` option matches whole keys and takes no wildcard inside a name, so `*key*` is not expressible there. A log formatter masks the value of any field whose name contains `key`, `token`, `secret`, `password`, `authorization` or `cookie`, in any case, which covers `apiKey`, `x-api-key`, `authorization`, `cookie`, `set-cookie` and `accessToken`. Fields are flat by the `Logger` contract, so nested paths are not needed. Only names are checked, never values or the message text, so never put a secret in a message or in a field with an innocuous name. A field with a harmless name that contains one of those words, such as `monkey`, is masked too.

## Consequences

- Good: no API keys, no accounts, no network in tests; every failure is a typed result.
- Good: redaction covers a whole class of field names and is tested per name.
- Bad: a third party free service with no SLA; the stored rates stay in use while it is down.
- Bad: two new runtime dependencies (`pino`, `node-notifier`) and one dev-only types package (`@types/node-notifier`), plus bundled, unsigned Windows and macOS helper binaries.
- Bad: over-masking of harmless fields whose names match.
