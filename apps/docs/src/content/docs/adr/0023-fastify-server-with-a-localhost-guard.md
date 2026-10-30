---
title: "0023. Fastify server with a localhost guard, and the app shell"
description: The HTTP framework, how the server refuses requests from other sites, and how the app starts and stops.
---

- Status: Accepted
- Date: 2026-10-30

## Context and problem statement

The domain, the adapters and the plugin host exist ([ADR 0005](../0005-ports-and-adapters-for-dependencies/), [ADR 0022](../0022-store-gateway-over-the-plugin-host-and-debug-pages/)); something has to wire them together, serve the UI's JSON API on `localhost` ([ADR 0002](../0002-local-web-app-over-desktop-shell/)) and start and stop cleanly. A server on the loopback interface is still reachable from any page the user opens: a site can send requests to `127.0.0.1`, and with DNS rebinding a hostile name can resolve to it and read the answers. [ADR 0019](../0019-playwright-for-the-browser-driver/) left this for the API to close.

## Considered options

- Node's `http` with hand-written routing and validation. Rejected: request parsing, body limits and schema validation are what a framework is for.
- Express. Rejected: no built-in schema validation or typed routes, and body limits come from extra middleware.
- Fastify 5 with `fastify-type-provider-zod` 7. Chosen: built-in body limit and `inject` for tests, and the type provider types routes from the Zod schemas the code already uses. Version 7 needs Zod 4.2 or later; the app uses Zod 4.6. Its `@fastify/swagger` and `openapi-types` peers are only needed for OpenAPI output and are not installed.
- CORS with an allowlist. Rejected: the UI is served from the same origin, so no cross-origin access is needed at all.

## Decision outcome

`createServer` in `apps/fpving/src/server` builds Fastify with the Zod validator and serializer compilers and no Fastify logger, and the app binds it to `127.0.0.1` only. An `onRequest` hook refuses, with 421, any request whose `Host` header is not `127.0.0.1:<PORT>` or `localhost:<PORT>` (case-insensitive), which defeats DNS rebinding because the browser sends the hostile name. A request with a method other than GET, HEAD or OPTIONS that carries an `Origin` other than `http://<its Host>` is refused with 403; without `Origin`, as from curl, it is served. No CORS header is ever sent, so a cross-origin page cannot read any answer. Bodies are capped at 64 KiB (413). An error with a 4xx status answers its message; any other error answers `500 { "error": "internal error" }` and its full detail goes to the log only. `GET /api/health` answers `{ ok, version, plugins: { loaded, disabled } }`, where rejected `plugins.json` entries count as disabled.

`startApp` in `apps/fpving/src/app/start.ts` is the composition root. It parses the environment, creates `DATA_DIR` with mode `0o700` and tightens an existing one, opens the log at `DATA_DIR/logs/fpving.log`, runs `migrate` before opening the database, opens SQLite in WAL mode with a five second busy timeout, keeps the five newest migration backups, reads `plugins.json`, starts the plugin host with the saved ship-to country and display currency, and wires the real adapters into core: a system clock, random UUID ids, an unref'd timer `Scheduler` that splits delays longer than one Node timer can hold, Frankfurter rates, the OS notifier, the HTTP client and the Playwright driver sharing one domain limiter, the plugin store gateway and file debug sink, and the Anthropic judge when `ANTHROPIC_API_KEY` is set. Without a key the judge answers every call `unavailable`, which core already handles by saving candidates `unjudged`. Then it starts the scan schedule. Every replaceable port can be passed as an override in one `Partial<AppPorts>` object; tests use that with a temp `DATA_DIR`.

The plugin host keeps the settings it started with ([ADR 0021](../0021-plugin-worker-protocol/)), so changing the ship-to country or the display currency restarts the host; the settings route does that.

SIGINT, SIGTERM or the IPC message `shutdown` stop the scan schedule, close the server, shut the plugin host down, close the browser, the database and the log, in that order, once. A failing step is logged and the rest still run. The process exits 0 when every step succeeded within ten seconds and 1 otherwise. The IPC message exists because Windows has no catchable SIGTERM from another process; the boot test uses it on every OS. A startup failure (invalid environment, unusable `DATA_DIR`, failed migration, port in use) prints one line to stderr, never the API key, and exits 1.

The log rotates by size in-process: a line that would take the file past 10 MiB first moves it to `fpving.log.1`, shifting older files up to `fpving.log.5`. It is a small synchronous sink, so no transport dependency such as `pino-roll` is added.

## Consequences

- Good: a page on another site can neither drive nor read the API, without a CORS configuration to get wrong.
- Good: the whole app is built by one function, so integration tests run it in-process on fakes and a temp directory, and one test boots the real entry.
- Bad: the API is not reachable through another hostname, a LAN address or a reverse proxy; that is intended for a local app.
- Bad: a settings change that affects plugins restarts every plugin worker.
