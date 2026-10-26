---
title: Writing a plugin
description: The plugin contract, the context the host provides, and the contract test kit.
---

:::caution[Pre-release]
The SDK contract below exists in `@fpving/plugin-sdk` and is covered by tests, but nothing is released yet and it may still change. The host that loads plugins, isolates them in worker threads and schedules them is planned, not built.
:::

Plugins are for personal use. Respect each site's terms of service. Plugins are designed to run in worker threads for crash containment, not as a security sandbox (not built yet): install only plugins you trust.

## Contract

A plugin is an npm package or local folder that exports a `StorePlugin`:

- `manifest`: a `PluginManifest`, validated by `manifestSchema`.
  - `id`: lowercase letters, digits and hyphens.
  - `displayName`: not empty.
  - `version`: the plugin's canonical semver version, such as `1.2.3`.
  - `sdkVersion`: the semver range of `@fpving/plugin-sdk` the plugin supports, such as `^0.1.0`.
  - `domains`: at least one lowercase hostname, such as `shop.example.com`. No scheme, port, path or wildcard.
  - `capabilities`: at least one `PluginCapability`: `fetchListing`, `search`, `shippingToCountry`.
- `createStore(ctx)`: returns a `Store` bound to the host context.
  - `fetchListing(url)` resolves to a `StoreResult<FetchedListing>`.
  - `search(query)` resolves to a `StoreResult<SearchCandidate[]>`. Implement it exactly when the manifest declares `search`.

A `FetchedListing` is `{ title, itemPrice, shipping, inStock, images }`:

- `itemPrice` is `Money`: `{ amountMinor, currency }`, a positive integer in the currency's minor units and an ISO 4217 code. A price of `0` is rejected, because a store's placeholder price must never become a price snapshot.
- `shipping` is `{ kind: "known", amountMinor, currency }`, where `0` means free shipping, or `ShippingUnknown` (`{ kind: "unknown" }`) when the store does not show it. Unknown shipping is never treated as free.
- `images` are absolute `http` or `https` URLs.

A `SearchCandidate` is `{ url, title, itemPrice? }`, where `url` is an absolute URL string.

The host parses everything a plugin returns with these schemas (`fetchedListingSchema`, `searchCandidateSchema`, `storeErrorSchema`) before it reaches core.

## Errors

Store methods never throw for expected failures. They resolve to `err({ kind, detail })` with a `StoreErrorKind`:

| Kind                  | When                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `not_found`           | The product page is gone, for example HTTP 404.                                                                     |
| `blocked`             | A captcha or bot wall.                                                                                              |
| `parse_failed`        | The page loaded but could not be read. Attach the page as `rawPage`; the host will save it as a ready-made fixture. |
| `timeout`             | The host HTTP client or browser timed out.                                                                          |
| `network`             | Any other transport failure.                                                                                        |
| `unsupported_ship_to` | The store does not ship to `ctx.shipTo`.                                                                            |

`rawPage` exists only on `parse_failed`.

## Host-provided context

`ctx` is a `PluginContext`:

- `http.get(url, options?)` resolves to `{ status, body, headers }` or a `TransportError`.
- `browser.fetchPage(url)` renders a page and resolves to `{ status, html, finalUrl }` or a `TransportError`.
- `logger` has `debug`, `info`, `warn` and `error(message, fields?)`. Never log secrets, cookies or page bodies.
- `clock.now()` is the current time.
- `shipTo` is an ISO 3166-1 alpha-2 country code and `currencyPreference` an ISO 4217 code. Report prices in the store's own currency.

A `TransportError` has kind `timeout` or `network`, so a store can return it unchanged. Plugins do not bring their own Playwright or HTTP client. The host will own per-domain rate limits, jitter, timeouts, the browser profile and the user-agent.

```ts
import {
  err,
  ok,
  PluginCapability,
  ShippingUnknown,
  StoreErrorKind,
} from "@fpving/plugin-sdk";
import type { StorePlugin } from "@fpving/plugin-sdk";

const plugin: StorePlugin = {
  manifest: {
    id: "example-shop",
    displayName: "Example Shop",
    version: "1.0.0",
    sdkVersion: "^0.1.0",
    domains: ["shop.example.com"],
    capabilities: [PluginCapability.FetchListing],
  },
  createStore: (ctx) => ({
    fetchListing: async (url) => {
      const page = await ctx.browser.fetchPage(url);
      if (!page.ok) return err(page.error);
      const { status, html } = page.value;
      if (status === 404) return err({ kind: StoreErrorKind.NotFound, detail: url.href });
      const price = /data-price="(\d+)"/.exec(html)?.[1];
      if (price === undefined) {
        return err({ kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: html });
      }
      return ok({
        title: "Example frame",
        itemPrice: { amountMinor: Number(price), currency: "USD" },
        shipping: ShippingUnknown,
        inStock: true,
        images: [],
      });
    },
  }),
};

export default plugin;
```

## Loading

Planned: on boot the host will import each configured plugin, validate its manifest, check that the running SDK satisfies `sdkVersion` and register it. An invalid plugin will be logged and disabled while the app keeps running.

## Contract test kit

`@fpving/plugin-sdk/contract` gives you a ready Vitest suite. Vitest is an optional peer dependency needed only by this entry.

```ts
import { runStorePluginContract } from "@fpving/plugin-sdk/contract";
import type { ContractFixtures } from "@fpving/plugin-sdk/contract";
import plugin from "../src/index.js";

const fixtures: ContractFixtures = {
  shipTo: "IL",
  currencyPreference: "USD",
  pages: {
    "https://shop.example.com/p/1": {
      status: 200,
      body: "<html>…saved in-stock page…</html>",
    },
    "https://shop.example.com/p/2": {
      status: 200,
      body: "<html>…saved out-of-stock page…</html>",
    },
    "https://shop.example.com/p/gone": { status: 404, body: "Not found" },
    "https://shop.example.com/p/captcha": {
      status: 200,
      body: "<html>…saved captcha page…</html>",
    },
    "https://shop.example.com/p/garbage": {
      status: 200,
      body: "<html>unrelated</html>",
    },
  },
  listings: {
    inStock: "https://shop.example.com/p/1",
    outOfStock: "https://shop.example.com/p/2",
    notFound: "https://shop.example.com/p/gone",
    captcha: "https://shop.example.com/p/captcha",
    garbage: "https://shop.example.com/p/garbage",
  },
};

runStorePluginContract(plugin, fixtures);
```

Each check creates a fresh store over a fake context whose `http` and `browser` serve `pages` by URL. A request for a URL not in `pages` fails with a `network` error naming it. The checks:

- the manifest is schema-valid;
- the in-stock page parses to a schema-valid listing with `inStock: true`;
- the out-of-stock page parses to a schema-valid listing with `inStock: false`;
- the 404 page gives `not_found`;
- the captcha page gives `blocked`;
- the garbage page gives `parse_failed` with a `rawPage`;
- when the host times out, the store returns `timeout`;
- when the manifest declares `search`, `searchQuery` gives at least one schema-valid candidate. Add the search results page to `pages`.

A store that throws fails the check with the thrown error. To run the same checks without Vitest, `checkStorePluginContract(plugin, fixtures)` resolves to the list of failed checks.

## Distribution

This repository ships no store plugins. Keep yours in your own repository or a local folder and link it through `plugins.config.ts` (planned).
