---
title: Writing a plugin
description: The plugin contract, the context the host provides, and the contract test kit.
---

:::caution[Pre-release]
The SDK contract below is covered by tests and the app uses plugins for adding products, matching and scans, each in its own worker thread. The SDK is pre-1.0 and not published to npm, and the contract may still change.
:::

Plugins are for personal use. Respect each site's terms of service. Each plugin runs in its own worker thread for crash containment, not as a security sandbox: install only plugins you trust.

## Walkthrough

This takes a plugin from an empty folder to the **Plugins** screen. The SDK is not on npm, so you need a built clone of fpving: follow [Install](../getting-started/#install) and run `pnpm build`, which writes the SDK's `dist`. See [ADR 0032](../adr/0032-unpublished-packages-and-file-dependency-for-plugins/).

1. Create a folder outside the clone, with this `package.json`. Replace the `file:` path with the absolute path of your clone. `main` is the built ESM entry the host loads.

   ```json
   {
     "name": "fpving-plugin-example-shop",
     "version": "1.0.0",
     "private": true,
     "type": "module",
     "main": "./dist/index.js",
     "scripts": {
       "build": "tsc",
       "test": "vitest run"
     },
     "dependencies": {
       "@fpving/plugin-sdk": "file:/absolute/path/to/fpving/packages/plugin-sdk"
     },
     "devDependencies": {
       "typescript": "6.0.3",
       "vitest": "5.0.5"
     }
   }
   ```

2. Add a `tsconfig.json`:

   ```json
   {
     "compilerOptions": {
       "target": "ES2024",
       "module": "nodenext",
       "strict": true,
       "rootDir": "src",
       "outDir": "dist"
     },
     "include": ["src"]
   }
   ```

3. Run `npm install` or `pnpm install`. Both work and the plugin loads either way, but they differ after the clone changes. npm links to the clone, so a rebuilt SDK applies at once. pnpm keeps its own copy, which a plain install may not refresh, so run `pnpm install --force` after rebuilding.
4. Write the store in `src/index.ts`. Start from the [example](#host-provided-context) below and declare your own store's domain.
5. Save pages from the store and put them in `test/contract.test.ts`, starting from the [contract test kit](#contract-test-kit) below. Run `npm test`; every check should pass.
6. Run `npm run build`, which writes `dist/index.js`.
7. The app creates `DATA_DIR`, the one in the clone's `.env`, when it starts, so start it once if you have not and stop it. Then add the plugin folder's absolute path to `plugins.json` in `DATA_DIR`, replacing the placeholder:

   ```json
   [{ "path": "/absolute/path/to/your-plugin-folder" }]
   ```

8. Start the app again with `pnpm --filter @fpving/app start` in the clone and open **Plugins**. Your plugin shows as loaded with its domains. If it is disabled, the same line gives the reason; see [Loading](#loading).

After you change the plugin, build it and restart the app.

## Contract

A plugin is an npm package or local folder that exports a `StorePlugin`:

- `manifest`: a `PluginManifest`, validated by `manifestSchema`.
  - `id`: lowercase letters and digits in hyphen-separated words, such as `example-shop`, at most 64 characters.
  - `displayName`: not empty.
  - `version`: the plugin's canonical semver version, such as `1.2.3` or `1.2.3+build.1`. No `v` prefix.
  - `sdkVersion`: the semver range of `@fpving/plugin-sdk` the plugin was tested against, such as `>=0.0.0 <1.0.0`. Every `||` alternative must have an upper bound, so `^0.1.0`, `0.1.x`, `1.2.3` and `>=0.0.0 <1.0.0` pass while `*`, `x`, `>=0.0.0`, `>0.0.0` and `>=1.0.0` are rejected.
  - `domains`: at least one lowercase hostname, such as `shop.example.com`. No scheme, port, path or wildcard. Declare the bare domain: a pasted `www.` or `m.` link is mapped onto it, and your store is only ever given URLs on a declared domain.
  - `capabilities`: the `PluginCapability` values the plugin answers: `fetchListing`, which every plugin must declare, and optionally `search` and `shippingToCountry`.
- `createStore(ctx)`: returns a `Store` bound to the host context.
  - `fetchListing(url)` takes the product URL as an absolute http(s) string and resolves to a `StoreResult<FetchedListing>`.
  - `search(query)` resolves to a `StoreResult<SearchCandidate[]>`. Implement it exactly when the manifest declares `search`.

The SDK is pre-1.0: any `0.x` minor release may break the contract. Declare the range you test against, for example `>=0.0.0 <1.0.0` today, and narrow it once you test against a tagged release.

A `FetchedListing` is `{ title, itemPrice, shipping, inStock, images }`:

- `itemPrice` is `Money`: `{ amountMinor, currency }`, a positive integer in the currency's minor units and an ISO 4217 code. `CURRENCY_MINOR_UNITS` gives the decimal places: USD 19.99 is `1999`, JPY 1999 is `1999`, KWD 1.999 is `1999`. A price of `0` is rejected, because a store's placeholder price must never become a price snapshot.
- `shipping` is `{ kind: "known", amountMinor, currency }`, where the cost is an `Amount` (the non-negative sibling of `Money`, validated by `amountSchema`) and `0` means free shipping, or `ShippingUnknown` (`{ kind: "unknown" }`) when the store does not show it. Unknown shipping is never treated as free.
- `images` are absolute `http` or `https` URLs.

A `SearchCandidate` is `{ url, title, itemPrice? }`, where `url` is an absolute URL string.

The host parses everything a plugin returns with these schemas (`fetchedListingSchema`, `searchCandidateSchema`, `storeErrorSchema`) before it reaches core. Output that fails them becomes `parse_failed` with detail `invalid plugin output`.

Plugins run in worker threads, so every value crossing the host and plugin boundary is plain data that survives `structuredClone`. URLs are absolute http(s) strings everywhere, never `URL` objects.

## Errors

Store methods never throw for expected failures. They resolve to `err({ kind, detail })` with a `StoreErrorKind`:

| Kind                  | When                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `not_found`           | The product page is gone, for example HTTP 404.                                                                     |
| `blocked`             | A captcha or bot wall.                                                                                              |
| `parse_failed`        | The page loaded but could not be read. Attach the page as `rawPage`; the host saves it as a ready-made fixture.     |
| `timeout`             | The host HTTP client or browser timed out.                                                                          |
| `network`             | Any other transport failure.                                                                                        |
| `unsupported_ship_to` | The store does not ship to `ctx.shipTo`.                                                                            |

`rawPage` exists only on `parse_failed`. The host saves it to `DATA_DIR/debug/<plugin id>/<time>-<hash>.html`, where the hash is a SHA-256 prefix of the URL; a page over five megabytes is not saved. Each save deletes that plugin's pages older than 30 days, then its oldest until they fit 100 megabytes, so copy a page you want to keep. The result your store returned still reaches core unchanged.

## Host-provided context

`ctx` is a `PluginContext`:

- `http.get(url, options?)` takes an absolute http(s) URL string and resolves to `{ status, body, headers }` or a `TransportError`. Redirects are always followed. Once a redirect leaves the origin, only `accept`, `accept-language` and the host's `user-agent` are sent, for the rest of the chain, so a header such as `authorization` or `x-api-key` never reaches a host the store redirects to. If a store needs one of those on another origin, request that URL yourself.
- `browser.fetchPage(url)` renders a page and resolves to `{ status, html, finalUrl }`, where `finalUrl` is the URL string after redirects, or a `TransportError`.
- `logger` has `debug`, `info`, `warn` and `error(message, fields?)`. Never log secrets, cookies or page bodies.
- `clock.now()` is the current time.
- `shipTo` is an ISO 3166-1 alpha-2 country code and `currencyPreference` an ISO 4217 code. Report prices in the store's own currency.

A `TransportError` has kind `timeout` or `network`, so a store can return it unchanged. Plugins do not bring their own Playwright or HTTP client. The host owns per-domain rate limits, jitter, timeouts, the browser profile and the user-agent.

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
    sdkVersion: ">=0.0.0 <1.0.0",
    domains: ["shop.example.com"],
    capabilities: [PluginCapability.FetchListing],
  },
  createStore: (ctx) => ({
    fetchListing: async (url) => {
      const page = await ctx.browser.fetchPage(url);
      if (!page.ok) return err(page.error);
      const { status, html } = page.value;
      if (status === 404) return err({ kind: StoreErrorKind.NotFound, detail: url });
      if (html.includes("data-captcha")) return err({ kind: StoreErrorKind.Blocked, detail: url });
      const price = /data-price="(\d+)"/.exec(html)?.[1];
      if (price === undefined) {
        return err({ kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: html });
      }
      return ok({
        title: "Example frame",
        itemPrice: { amountMinor: Number(price), currency: "USD" },
        shipping: ShippingUnknown,
        inStock: !html.includes("data-sold-out"),
        images: [],
      });
    },
  }),
};

export default plugin;
```

## Loading

Users list plugins in `plugins.json` in the data directory, by absolute folder path or npm package name. See [Configuration](../configuration/#plugins).

`SDK_VERSION` is the version of the running `@fpving/plugin-sdk`, read from its `package.json`. The host accepts a plugin only when `SDK_VERSION` satisfies its manifest's `sdkVersion`, decided by `satisfiesSemverRange` with npm's rules; otherwise the plugin is disabled as `sdk_incompatible`, with a reason naming the range and the version. A prerelease SDK satisfies only a range that names a prerelease of the same version.

The host then maps each declared domain to its plugin and matches a URL's hostname exactly. A domain that two or more plugins declare goes to none of them, and each of them gets a `domain_conflict` warning naming the others, so the outcome never depends on load order. A plugin left with no domain is disabled. Plugins that share a manifest `id`, store or catalog, are all disabled as `duplicate_id` and claim none of their domains; a domain one of them declares still goes to another plugin when that plugin is its only other declarer.

Each entry gets its own worker thread, which imports the plugin:

- A folder entry is loaded the way `require(folder)` finds it: the `main` of the folder's `package.json`, else `index.js`. Folder resolution does not read `exports`, so set `main` to your built ESM entry.
- A package entry is imported by name from the app's own directory, with Node's ESM resolution, so `exports` and its `import` condition apply. See [Configuration](../configuration/#plugins).
- The plugin is the module's default export when that is an object, as in the example above, else the module itself, so named `manifest` and `createStore` exports work too. Anything else, or a manifest that fails `manifestSchema`, disables the plugin as `manifest_invalid`; a module that cannot be imported, or a `createStore` that throws, as `load_failed`. A plugin has thirty seconds to load.
- `createStore` is called once per worker. The store must have `fetchListing`, and `search` when the manifest declares it, or the plugin is `manifest_invalid`.

At run time:

- A worker starts with an empty environment, so `process.env` holds none of the host's variables, its API key included. A plugin that needs a secret reads it from its own file.
- `http.get` and `browser.fetchPage` are served by the host, so its rate limits, timeouts and URL policy apply. `logger` calls are written to the host log with your `pluginId` added. `clock.now()` is the worker's own clock.
- A store method that throws or rejects, or resolves to something that cannot be structured-cloned, gives `parse_failed`.
- A call has two minutes. When it runs out the call resolves to `timeout` and the worker is terminated, and so is a worker that throws an uncaught error or exits; other open calls on it get `network`. The worker is restarted once; a second failure disables the plugin as `crashed` until the app restarts. A failure before every plugin has loaded disables it straight away. If the restarted worker reports a different manifest, because the plugin changed on disk, the plugin is disabled as `manifest_invalid` until the app restarts. The host never calls `search` on a plugin whose manifest does not declare it, and lists only loaded plugins that declare it as searchable. A busy loop is stopped the same way.
- A plugin disabled after it loaded, for example as `crashed`, keeps its domains for the session, so a link to its store still names it, but every call to it resolves to `network` with the detail `the plugin is not loaded` without reaching a worker. Scans stop at such a plugin and leave its listings as they are, so they do not go stale because of it. A plugin disabled at startup never enters the domain registry, so its domains resolve to no plugin.

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
      body: '<html><div data-price="1999"></div></html>',
    },
    "https://shop.example.com/p/2": {
      status: 200,
      body: '<html><div data-price="1999" data-sold-out></div></html>',
    },
    "https://shop.example.com/p/gone": { status: 404, body: "Not found" },
    "https://shop.example.com/p/captcha": {
      status: 200,
      body: "<html><div data-captcha></div></html>",
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

- every fixture URL is an absolute http(s) URL; if one is not, only this check runs and fails with a fixture error, so your plugin is not blamed;
- the manifest is schema-valid (a malformed manifest fails this check rather than crashing the suite);
- the in-stock page parses to a schema-valid listing with `inStock: true`;
- the out-of-stock page parses to a schema-valid listing with `inStock: false`;
- the 404 page gives `not_found`;
- the captcha page gives `blocked`;
- the garbage page gives `parse_failed` with a `rawPage`;
- when the host times out, the store returns `timeout`;
- when the manifest declares `search`, `searchQuery` gives at least one schema-valid candidate. Add the search results page to `pages`.

A store that throws fails the check with the thrown error. To run the same checks without Vitest, import `checkStorePluginContract` from `@fpving/plugin-sdk/contract/check`: it resolves to the list of failed checks, and nothing it imports loads Vitest.

## Catalog plugins

A catalog plugin bundles known gear for the **My gear** screen. It is a separate kind of plugin: its manifest has `kind: "catalog"` and no `domains` or `capabilities`, and it is listed in `plugins.json` like a store plugin. The manifest is validated by `catalogManifestSchema`, and a catalog is built by `createCatalog(ctx)`; see [ADR 0039](../adr/0039-catalog-plugins/).

```ts
import { PluginKind } from "@fpving/plugin-sdk";
import type { CatalogEntry, CatalogPlugin } from "@fpving/plugin-sdk";

const entries: CatalogEntry[] = [
  {
    key: "radiomaster-boxer",
    name: "RadioMaster Boxer",
    specs: { kind: "radio", rcLink: "elrs-2g4", firmware: "edgetx" },
  },
];

const plugin: CatalogPlugin = {
  manifest: {
    kind: PluginKind.Catalog,
    id: "example-catalog",
    displayName: "Example Catalog",
    version: "1.0.0",
    sdkVersion: ">=0.0.0 <1.0.0",
  },
  createCatalog: () => ({
    search: async (text) => ({
      ok: true,
      value: entries.filter(({ name }) => name.toLowerCase().includes(text.toLowerCase())),
    }),
    get: async (key) => ({ ok: true, value: entries.find((entry) => entry.key === key) ?? null }),
  }),
};

export default plugin;
```

- `search(text)` resolves to the entries whose name matches, and `get(key)` to the entry with that stable `key`, or `null`.
- Both resolve to a `Result` and never reject. A catalog that cannot answer resolves to `err({ kind: CatalogErrorKind.Failed, detail })`.
- An entry is `{ key, name, specs }`. `specs` follows `gearSpecsSchema`, whose `kind` is `radio`, `goggles`, `quad`, `battery`, `charger` or `tool`. Every other field is optional, and a field you leave out is unknown, never a default.
- The context holds only `logger` and `clock`. A catalog is given no `http`, no `browser` and no domains, and once it has loaded the host refuses any capability call it sends: bundle the data inside the plugin. Worker threads are not a security boundary ([ADR 0004](../adr/0004-worker-thread-plugin-isolation/)), so install only plugins you trust.
- The host copies a spec when the user saves an item, so a catalog can change an entry later. The item then shows a Changed warning and the user decides; see [Getting started](../getting-started/#what-exists-today).

## Distribution

This repository ships no store plugins. Keep yours in your own repository or a local folder and list it in `plugins.json`.
