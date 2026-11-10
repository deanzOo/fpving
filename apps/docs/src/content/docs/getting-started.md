---
title: Getting started
description: How to install and run fpving, the first-run flow, and what exists.
---

:::caution[Early]
fpving is pre-1.0 and interfaces can change between releases. You run it from a clone of the repository.
:::

## Install

You need Node 24 (`nvm install` reads `.nvmrc`), which includes corepack.

```sh
git clone https://github.com/deanzOo/fpving.git
cd fpving
corepack enable
pnpm install
pnpm --filter @fpving/app exec playwright install chromium
pnpm worktree:init
```

Chromium is the browser that plugins fetch pages through. The app starts without it, a plugin that only uses HTTP never needs it, and for any other plugin a missing browser shows up as a `network` error on the first page. `pnpm worktree:init` writes a `.env` with this checkout's own port and data directory. See [Contributing](../contributing/).

## First run

1. Start the local server (see [Running the server](#running-the-server)) and open the address it prints.
2. Open **Settings** and choose a display currency and ship-to country.
3. List the store plugins you installed in `plugins.json` in the data directory, restart the app and check them under **Plugins**. fpving ships none; to write one, see [Writing a plugin](../writing-a-plugin/).
4. Add a product by pasting a store URL. The plugin that handles that domain fetches the listing.
5. Review match suggestions for other stores and accept or reject each one.
6. Leave the app running. It scans on an interval, catches up on boot, and raises alerts.

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
- The UI in `apps/ui`: the app shell with its navigation and seven screens.
  - Watchlist: paste a store URL to watch a product, see each product's cheapest landed cost, its 30-day price trend and its unread alerts, and start a scan with the last scan's result beside it. A URL another product already watches links to that product.
  - Product: rename it, stop watching it (after a confirm step), see each listing's store, latest price, shipping, landed cost, stock and status, remove a listing, add one by URL, and a chart of each listing's landed cost over time.
  - Matches: the pending match candidates of every product, with the judge's verdict and reason and the similarity, to accept or reject, and a search for more per product. Candidates judged different are hidden until you ask to see them.
  - Alerts: every alert newest first or only the unread ones, marking one or all of them read.
  - Settings: every setting in one form.
  - Plugins: each `plugins.json` entry with its state (loaded, disabled with the reason, or backing off and when it retries), its domains and its stale and not scanned listing counts, plus rows for the listings of a plugin no longer in `plugins.json`, plus rejected entries and an unusable `plugins.json`.
  - Atlas: a 3D motor, a 4-in-1 ESC, a flight controller, analog and digital video systems, a 5 inch frame and a set of bolts to turn, take apart and click, with what each piece does, how it works, what goes wrong and what to look at. The bolts come with a table of common sizes. The motor also shows its coils taking turns, slowed right down.
- The app shell: `startApp` wires every adapter into core, and a Fastify server on `127.0.0.1` answers `GET /api/health` and the domain routes (the watchlist, products, listings, match candidates, alerts, settings, plugins, scan now), refuses requests addressed to other hosts or sent from other sites, and shuts down cleanly on Ctrl+C or SIGTERM.

To work on it, follow the setup in [Contributing](../contributing/).

## Running the server

After the install above:

```sh
pnpm build
pnpm --filter @fpving/app start
```

`pnpm build` also builds the UI into `apps/ui/dist/web`. Open `http://127.0.0.1:<PORT>` (or `http://localhost:<PORT>`), with the `PORT` from your `.env`, to use it; the address is printed when the server is listening. Any other host name is refused. Without a UI build the page says to run `pnpm build`.

To work on the UI with hot reload, keep the server running and start Vite in a second terminal:

```sh
pnpm dev
```

Then open the address Vite prints. Vite forwards `/api` to the server on your worktree's `PORT`, so both must belong to the same worktree.

It builds, loads the worktree's `.env` (a variable already set in the shell wins), creates `DATA_DIR`, listens on `http://127.0.0.1:<PORT>` and migrates the database; until startup completes the API answers 503 `starting` on every route but health, while the UI already loads and shows that error with a retry. Check it with `curl http://127.0.0.1:<PORT>/api/health`. Logs go to `DATA_DIR/logs/fpving.log`. Stop it with Ctrl+C. During a scan, stopping waits up to ten seconds for it and then exits 1; a second Ctrl+C is ignored meanwhile. Ctrl+C while it starts cancels the startup. A startup failure, such as the port being taken by another instance, prints one line and exits 1 before the database is touched. Leaving it running starts the scan schedule, which fetches exchange rates from the Frankfurter API on the first boot. See [Configuration](../configuration/).
