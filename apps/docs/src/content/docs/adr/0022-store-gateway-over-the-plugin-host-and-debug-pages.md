---
title: "0022. Store gateway over the plugin host, and debug pages on disk"
description: How the StoreGateway answers plugins that are not loaded, and where unparseable pages are saved.
---

- Status: Accepted
- Date: 2026-10-30

## Context and problem statement

[ADR 0014](../0014-store-gateway-port/) defines `StoreGateway` and [ADR 0013](../0013-id-generator-and-debug-sink-ports/) defines `DebugSink`; [ADR 0021](../0021-plugin-worker-protocol/) built the worker runtime they sit on. Three things were left open: what a call to a plugin that crashed or never loaded returns, whether such a plugin keeps its domains, and how a `parse_failed` page is laid out on disk, given that its URL and plugin id come from plugins.

## Considered options

- Drop a disabled plugin's domains from `declaredDomains` and `pluginFor`. Rejected: a pasted link to its store would then read "no plugin for this site" instead of naming the plugin that is down.
- Let calls to a disabled plugin reach the host, which answers `network` from deep inside the runtime. Rejected: core would see the same detail as a transient failure, and the gateway would depend on the host's internal wording.
- Answer them in the gateway with a stable detail, and keep the domains. Chosen.
- Name debug files after the URL. Rejected: URL text in a path invites traversal, overlong names and characters some file systems refuse.

## Decision outcome

`createPluginStoreGateway` takes the domains and `pluginFor` from the host's registry, which is fixed at startup, so a plugin disabled later keeps its domains. Before calling the host it checks the plugin's current status: a plugin id that is not loaded now resolves to `network` with the detail `the plugin is not loaded`, and a search through a loaded plugin whose manifest does not declare `search` to `network` with `the plugin does not declare search`, both without reaching a worker. `searchablePlugins` lists only loaded plugins that declare `search`, read at call time. Both details are the `GatewayRefusal` constants. `StoreErrorKind` is a closed SDK taxonomy, so `network` is the closest kind; a new kind would be an SDK change.

When a fetch resolves to `parse_failed` with a `rawPage`, the gateway passes it to the `DebugSink` and returns the fetch result unchanged; a failed save is logged as a warning and changes nothing else.

`createFileDebugSink` writes `DATA_DIR/debug/<pluginId>/<UTC time>-<first 16 hex digits of sha256(url)>.html`, with the time's `:` and `.` replaced by `-`. The plugin id must pass the plugin id schema (lowercase letters, digits and single hyphens) or the page is refused, so nothing a plugin controls can leave that folder, and no URL text reaches the path. Folders are created `0o700` and files `0o600`. A page over five megabytes of UTF-8 (`MAX_DEBUG_PAGE_BYTES`, the HTTP client's body cap) is refused rather than truncated, because a truncated page is not a faithful fixture. Every failure is a `debug_write_failed` result; the sink never rejects. Its clock is injected.

Every `StoreGateway` must pass `describeStoreGatewayContract` from `@fpving/core/testing`; core runs it against its fake, and the app against the real gateway with a test-only fixture plugin on real worker threads.

## Consequences

- Good: a scan of a crashed plugin's listings records one clear, constant reason per listing, and the Plugins screen shows the real one from the host.
- Good: debug paths are bounded and predictable, and a fixture can be dropped straight into a plugin's contract test.
- Bad: listings of a plugin that stays down still count failures and can go `stale`, like any other failure kind.
- Bad: the debug folder has no size or age limit yet.
