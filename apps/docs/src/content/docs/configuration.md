---
title: Configuration
description: Planned settings, the plugin list, the data directory, the server and logging.
---

:::caution[Planned]
No settings screen exists yet; the settings section records its intended shape. The plugin list, data directory, server, secrets and logging sections describe what is implemented.
:::

## Settings

| Setting | Meaning |
| --- | --- |
| `displayCurrency` | ISO 4217 code prices are shown in, for example `ILS`. |
| `shipToCountry` | ISO 3166 country the landed cost is computed for, for example `IL`. |
| `importTax` | `{ dutyFreeThreshold, vatBasisPoints, thresholdBasis }`. VAT applies above the threshold, which may be zero to tax everything; `vatBasisPoints` is hundredths of a percent, so 1800 is 18%, and `thresholdBasis` says whether the threshold is compared with the item alone or with item plus shipping. |
| `scanIntervalHours` | How often listings are rescanned while the app runs. |
| `priceDropMinBasisPoints` | Minimum drop below the previous 30-day low to alert, in hundredths of a percent, so the default 500 is 5%. |

Country presets are a typed table. The first version ships Israel only: 18% VAT on item plus shipping once the item is above USD 75, per the Israel Tax Authority page recorded as the preset's source. Landed cost includes VAT only, not purchase tax or customs duty (which can apply to Israeli parcels above USD 500), and the preset is user-editable. Other countries are added by pull request; unknown countries are filled in by hand.

## Landed cost

`landed = item + shipping + importTax(item, shipping)`, shown in the display currency at the current exchange rate. The pricing code behind this exists and is tested; the settings screen does not. Unknown shipping is never treated as zero.

Changing `shipToCountry` invalidates shipping; the next scan refetches. Old snapshots are kept, tagged with their original destination, and snapshots for different destinations are never compared.

## Plugins

The plugin list is `plugins.json` in `DATA_DIR`. It is a JSON array with one entry per plugin, either a local folder or an npm package:

```json
[
  { "path": "/home/pilot/fpving-plugins/example-shop" },
  { "package": "fpving-plugin-example" },
  { "package": "@pilot/fpving-shop" }
]
```

- No file means no plugins. That is not an error.
- A file that cannot be read, is not valid JSON or is not an array disables every plugin with a `config_invalid` reason. The app still runs, with no plugins.
- Each entry is checked on its own, and a bad one disables only itself with an `entry_invalid` reason. An entry has exactly one key. `path` must be absolute; relative paths are rejected, because they would depend on the directory the app starts from. `package` must be a valid npm package name, scoped or not, at most 214 characters.
- Folder paths are normalized, so `/a/b/` and `/a/x/../b` are the same folder. A later entry naming the same folder or package as an earlier one is rejected as `duplicate_entry`, and the first one stays.
- `plugins.json` must be a regular file. A folder or a named pipe in its place is refused as `config_invalid`, so a pipe can never block start-up.

A `path` entry loads the folder's `package.json` `main` (or `index.js`). A `package` entry is imported by name from the app's directory (`apps/fpving` in a checkout), with Node's ESM resolution walking up through its `node_modules`, so the package must be installed where the app can resolve it, for example with `pnpm --filter @fpving/app add <package>`. This root is the app's own, not `DATA_DIR/node_modules`, because Node can run its ESM resolution, which honours `exports` and the `import` condition, only from a module's own location. To use a plugin that is installed elsewhere, list its folder with `path`.

The host loads each entry in its own worker thread (`apps/fpving/src/plugins/runtime`) when the app starts, with the saved ship-to country and display currency; changing either restarts the plugins. Edit `plugins.json` and restart the app to load a new list. See [Writing a plugin](../writing-a-plugin/) and [ADR 0020](../adr/0020-plugin-list-in-data-dir-plugins-json/).

## Data directory

`DATA_DIR` is created on start with mode `0o700`. An existing one keeps its mode, and the log warns when group or others can open it; run `chmod 700` on it. On Windows the mode is not enforced: the folder inherits its parent's ACL. It holds the SQLite database `fpving.db` (WAL mode, so `fpving.db-wal` and `fpving.db-shm` appear while the app runs), `plugins.json`, `logs/`, `debug/` and the browser profile in `browser-profile/`. Before a migration changes an existing database it is copied to `fpving.db.<UTC time>.bak`; after a successful migration only the five newest backups are kept, by the time in their names, always including the one just made. Only regular files named exactly that way are deleted, so a `.bak` of your own is left alone.

## Server

The server listens on `127.0.0.1:PORT` only. It answers only requests whose `Host` header is `127.0.0.1:PORT` or `localhost:PORT` (others get 421), refuses state-changing requests sent from another origin, or marked `Sec-Fetch-Site: cross-site` or `same-site` (403), sends no CORS headers and accepts bodies up to 64 KiB. See [ADR 0023](../adr/0023-fastify-server-with-a-localhost-guard/).

## Secrets

The Anthropic API key used for matching is bring-your-own and optional. `pnpm eval:matcher` reads `ANTHROPIC_API_KEY` from the environment or from a `.env` in the working directory, and runs the matcher eval against the real model, which costs API credits; with the key unset or blank it skips. A variable already set in the shell takes precedence over `.env`, because Node's `--env-file` does not override it. `parseEnv` trims the key, rejects one that is blank after trimming, and its error text never contains it. The Anthropic adapter never logs it and always sends it to `https://api.anthropic.com`, so an `ANTHROPIC_BASE_URL` set in the shell cannot redirect it. `pnpm --filter @fpving/app start` loads `.env` from the repository root the same way. With a key the app judges match candidates with the Anthropic adapter; without one it saves them `unjudged` and logs that once at startup.

## Logging

`LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`, default `info`) sets the minimum level the pino logger writes. The app logs to `DATA_DIR/logs/fpving.log`. A line that would take the file past 10 MiB first moves it to `fpving.log.1`, shifting older ones up to `fpving.log.5`, and the oldest is dropped; the folder and files are owner-only. Any logged field whose name contains `key`, `token`, `secret`, `password`, `authorization` or `cookie` is written as `[redacted]`. Exchange rates need no key: they come from the Frankfurter API. Notifications use the built-in `osascript` on macOS, Windows toasts through `node-notifier` on Windows, and `notify-send` (libnotify), which must be on the path, on Linux.
