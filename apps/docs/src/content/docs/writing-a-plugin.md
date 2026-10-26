---
title: Writing a plugin
description: The plugin contract, the context the host provides, and the planned contract test kit.
---

:::caution[Planned]
The plugin SDK is under construction. Only the `Result` type and its `ok` and `err` constructors are exported today. The contract below is the design, not a stable API.
:::

Plugins are for personal use. Respect each site's terms of service. Plugins are designed to run in worker threads for crash containment, not as a security sandbox (not built yet): install only plugins you trust.

## Contract

A plugin is an npm package or local folder that exports:

- `manifest`: `id`, `displayName`, `version`, `sdkVersion`, `domains` and `capabilities` (`fetchListing`, `search`, `shippingToCountry`).
- `createStore(ctx)`, returning `{ fetchListing(url), search(query) }`.

`fetchListing` returns `{ title, itemPrice, shipping, inStock, images }`, where `itemPrice` is money and `shipping` is money or unknown, or a typed error. `search` returns candidate listings.

Errors use the SDK taxonomy: `not_found`, `blocked`, `parse_failed`, `timeout`, `network` and `unsupported_ship_to`. Return them as `Result` values rather than throwing.

## Host-provided context

`ctx` carries `http`, `browser`, `logger`, `clock`, `shipTo` and `currencyPreference`. Plugins do not bring their own Playwright or HTTP client. The host owns per-domain rate limits, jitter, timeouts, the browser profile and the user-agent.

## Loading

On boot the host imports each configured plugin, validates its manifest, checks SDK semver compatibility and registers it. An invalid plugin is logged and disabled and the app keeps running. All plugin output is parsed before it enters core.

## Contract test kit

Planned: `runStorePluginContract(plugin, fixtures)` will give an author a ready Vitest suite covering fixture parsing, valid shapes, out-of-stock, 404, captcha handling and timeout behaviour.

## Distribution

This repository ships no store plugins. Keep yours in your own repository or a local folder and link it through `plugins.config.ts`.
