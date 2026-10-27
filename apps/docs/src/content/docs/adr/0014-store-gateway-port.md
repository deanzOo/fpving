---
title: "0014. StoreGateway port"
description: StoreGateway port between core and the plugin host.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

Adding a product needs a store plugin: find the plugin for a pasted URL, fetch the listing, and later search other stores for matches. Plugins run in the plugin host ([ADR 0004](../0004-worker-thread-plugin-isolation/)), which is not built yet. Core must use them without knowing about workers, manifests or loading. A pasted link must also dedupe against the listing already tracking the same page, so `m.` and `www.` hosts have to be mapped onto the hostnames plugins declare before the plugin is known.

## Considered options

- Hand core the loaded `StorePlugin` modules and let it match manifests itself.
- A `StoreGateway` port that the plugin host implements, with `domainsFor(pluginId)` for normalization.
- A `StoreGateway` port with `declaredDomains()`, the flat list of every declared hostname.

## Decision outcome

Core defines `StoreGateway`: `declaredDomains()`, `pluginFor(url)`, `fetchListing(pluginId, url)`, `search(pluginId, query)` and `searchablePlugins()`. Normalization runs before any plugin is known, so `domainsFor(pluginId)` would be circular; it takes the flat `declaredDomains()` list instead and stays a pure function. `pluginFor` then matches the normalized hostname exactly, as the manifest's `domains` already promises, so a plugin always receives a URL on a domain it declared.

## Consequences

- Good: core and its tests never touch workers or plugin modules; tests use an in-memory fake.
- Good: one URL form for dedupe, and plugins only see hosts they declared.
- Bad: a plugin that declares only `www.example.com` gets no `m.example.com` links mapped onto it; plugins should declare the bare domain.
