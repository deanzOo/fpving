---
title: "0021. Plugin worker protocol"
description: How the host and a plugin's worker thread talk, how plugins are imported, and how failures are contained.
---

- Status: Accepted
- Date: 2026-10-29

## Context and problem statement

[ADR 0004](../0004-worker-thread-plugin-isolation/) puts each plugin in its own worker thread. The host and the worker then need a message protocol, a way to give the plugin `http`, `browser`, `logger` and `clock` without moving the real adapters into the worker, a rule for which file a `plugins.json` entry imports, and a restart policy that never leaves a call hanging.

## Considered options

- Hand the worker its own `HttpClient` and `BrowserDriver`. Rejected: per-host rate limits, the URL policy and the one browser profile must stay in one place.
- An RPC library over `MessagePort`. Rejected: a new dependency for six message types.
- Zod-validated messages with request ids, and capability calls forwarded to the host. Chosen.

## Decision outcome

- Every message is a Zod discriminated union on `type`, validated on receipt in both directions. Host to worker: `call` (`fetchListing` or `search`) and `capability-result`. Worker to host: `ready` (the manifest), `load-failed`, `call-result`, `capability-call` (`http.get` or `browser.fetchPage`) and `log`. Calls and capability calls carry ids, one counter per direction. A malformed message is logged and dropped, never thrown.
- The worker's `PluginContext` forwards `http.get` and `browser.fetchPage` to the host, which serves them with the injected ports; `logger` calls become fire-and-forget `log` messages written with `pluginId` added; `clock` is local to the worker.
- The host parses every `call-result` with the SDK schemas. Anything else becomes `parse_failed` with detail `invalid plugin output`. A store method that throws or rejects, or returns something that cannot be structured-cloned, also becomes `parse_failed`.
- A folder entry is resolved like `require(folder)`: the folder's `package.json` `main`, else `index.js`. A package entry is a bare `import()` from the host's own module, so Node's ESM resolution, with `exports` and the `import` condition, runs from the app's directory. `DATA_DIR/node_modules` was rejected: Node offers no ESM resolution from an arbitrary directory, and `createRequire` resolution uses the `require` condition, which misses packages that export only `import`.
- A module's default export is the plugin when it is an object, else the module itself; it must have `manifest` and `createStore`. The worker validates the manifest, calls `createStore` once, checks the store has `fetchListing` (and `search` when declared), then posts `ready`. A worker has thirty seconds to report.
- Calls have a two minute deadline (`CALL_TIMEOUT_MS`). A missed deadline, a worker `error` or an unexpected `exit` fails every open call on that worker with a typed error (`timeout` for the expired call, `network` for the rest) and restarts the worker once; a second failure disables the plugin for the session as `crashed`. Load failures are not retried.

## Consequences

- Good: the transports, limiter and browser profile stay on the host thread, and plugin output is never trusted.
- Good: no call can hang: deadlines, crashes and shutdown all resolve it.
- Bad: a busy-looping plugin holds a CPU core until its deadline.
- Bad: a package plugin must be resolvable from the app's install, so users of an installed app list a folder instead.
