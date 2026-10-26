---
title: Getting started
description: The planned first-run flow, and what exists today.
---

:::caution[Not built yet]
The app is not released. Everything below under "Planned flow" describes the intended experience. Only the contributor setup works today.
:::

## Planned flow

1. Install Node 24 and fetch fpving.
2. Start the local server. Open the UI at `localhost` in your browser.
3. Open **Settings** and choose a display currency and ship-to country.
4. Open **Plugins** and point `plugins.config.ts` at the store plugins you installed. fpving ships none.
5. Add a product by pasting a store URL. The plugin that handles that domain fetches the listing.
6. Review match suggestions for other stores and accept or reject each one.
7. Leave the app running. It scans on an interval, catches up on boot, and raises alerts.

If no plugin handles a URL's domain, adding a product fails with a clear message naming the domain.

## What exists today

The monorepo, build tooling, CI and the first public SDK types. To work on it, follow the setup in [Contributing](../contributing/).
