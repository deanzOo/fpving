---
title: Getting started
description: The planned first-run flow, how to run the server today, and what exists.
---

:::caution[Not built yet]
The app is not released. Everything below under "Planned flow" describes the intended experience. Today the server starts and answers a health check; the UI and the domain routes are not built yet.
:::

## Planned flow

1. Install Node 24 and fetch fpving.
2. Start the local server. Open the UI at `localhost` in your browser.
3. Open **Settings** and choose a display currency and ship-to country.
4. List the store plugins you installed in `plugins.json` in the data directory and check them under **Plugins**. fpving ships none.
5. Add a product by pasting a store URL. The plugin that handles that domain fetches the listing.
6. Review match suggestions for other stores and accept or reject each one.
7. Leave the app running. It scans on an interval, catches up on boot, and raises alerts.

If no plugin handles a URL's domain, adding a product fails with a clear message naming the domain.

## What exists today

The monorepo, build tooling and CI, plus the domain layer in `@fpving/core` and the plugin contract in `@fpving/plugin-sdk`:

- The public plugin SDK: types, schemas, the error taxonomy and the contract test kit.
- Pricing: exchange rate conversion, import tax, landed cost and the Israel country preset.
- The domain entities and the ports the host and adapters implement, with shared repository and store gateway contract suites.
- The alert evaluator: price drop, back in stock and new cheapest, as a pure function.
- Adding a product or a listing from a pasted URL, with URL normalization, behind the `StoreGateway` port, which the plugin host implements.
- Assisted matching: searching the other stores, ranking and LLM-judging candidates, and accepting or rejecting them.
- Scanning: re-fetching every tracked listing, recording prices, marking listings stale or gone, backing off blocked stores, and raising and notifying alerts.
- The scan schedule: a scan every interval, one catch-up scan on boot, stale exchange rates refreshed first, and no overlapping scans, on unref'd Node timers.
- The plugin list in `DATA_DIR/plugins.json`, the check of each plugin's `sdkVersion` against the SDK, and the map from declared domains to plugins. The plugin host loads each listed plugin in its own worker thread, with call deadlines, one restart and a status for each plugin; the store gateway routes core's fetches and searches to it, and the pages a plugin cannot parse are saved under `DATA_DIR/debug/`.
- Environment config: `apps/fpving` parses `PORT`, `DATA_DIR`, an optional `ANTHROPIC_API_KEY` and `LOG_LEVEL`, and reports every invalid variable by name without echoing a value.
- `pnpm worktree:init`, which gives each git worktree its own `.env` with a stable port and data directory. See [Contributing](../contributing/).

- The app shell: `startApp` wires every adapter into core, and a Fastify server on `127.0.0.1` answers `GET /api/health`, refuses requests addressed to other hosts or sent from other sites, and shuts down cleanly on Ctrl+C or SIGTERM.

To work on it, follow the setup in [Contributing](../contributing/).

## Running the server

After the contributor setup and `pnpm worktree:init`:

```sh
pnpm --filter @fpving/app start
```

It builds, loads the worktree's `.env` (a variable already set in the shell wins), creates `DATA_DIR`, listens on `http://127.0.0.1:<PORT>` and migrates the database; until startup completes only the health route answers. Check it with `curl http://127.0.0.1:<PORT>/api/health`. Logs go to `DATA_DIR/logs/fpving.log`. Stop it with Ctrl+C. During a scan, stopping waits up to ten seconds for it and then exits 1; a second Ctrl+C is ignored meanwhile. Ctrl+C while it starts cancels the startup. A startup failure, such as the port being taken by another instance, prints one line and exits 1 before the database is touched. Leaving it running starts the scan schedule, which fetches exchange rates from the Frankfurter API on the first boot. See [Configuration](../configuration/).
