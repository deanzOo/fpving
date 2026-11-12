---
title: "0039. Catalog plugins"
description: Why known gear comes from a separate plugin kind with no network access, and why a saved item keeps its own copy of each spec.
---

- Status: Accepted
- Date: 2026-11-12

## Context and problem statement

My gear lets a user say what they own. Typing every spec is slow and error-prone, so the app should offer known gear with its specs filled in. That data has to come from somewhere other than the app, as store support does ([ADR 0004](../0004-worker-thread-plugin-isolation/)). It also has to be trustworthy: a spec the app guessed, or one a catalog later changes, must never silently replace what the user confirmed.

## Considered options

- Bundle a gear list in the app. Every addition would need a release.
- Add `search` to store plugins. A store plugin needs network access and a domain, and gear data has neither.
- Fetch gear data from a web service. The app is local-first and would depend on a server.
- A separate catalog plugin kind, with its data bundled inside.

## Decision outcome

Add a catalog plugin kind beside store plugins. Its manifest is `{ kind: "catalog", id, displayName, version, sdkVersion }`, and a manifest without a `kind` stays a store plugin, so existing store manifests do not change. A catalog is built from `{ logger, clock }` only: it is given no HTTP client, no browser and no domains, the host refuses any capability call its worker sends, and its data ships inside the plugin. Worker threads are not a security boundary ([ADR 0004](../0004-worker-thread-plugin-isolation/)), so install only catalogs you trust. It runs in its own worker thread like any plugin ([ADR 0021](../0021-plugin-worker-protocol/)), and starts with an empty environment ([ADR 0033](../0033-plugin-workers-start-with-an-empty-environment/)).

Specs are copied on save and their source is stored with them, either `catalog` with the plugin id or `user`. A saved item keeps its own copy. When a catalog later reports a different value, the item shows a Changed warning and the user picks Keep mine or Use catalog. When catalogs disagree the value is unknown until the user picks one, and a missing spec stays unknown and is never defaulted. A value read by the AI from pasted text is shown for checking and is stored as the user's once saved. Only text the user asks to read is sent to the AI.

## Consequences

- Good: a catalog is given no network capability, and gear data updates by updating a plugin, not the app.
- Good: store plugin manifests and the store gateway are unchanged.
- Good: the user's confirmed values are never overwritten without their say.
- Bad: a catalog cannot refresh itself from a live source. Its author republishes the plugin when the data changes.
- Bad: every saved item holds a copy of its specs, so a changed catalog shows up only as a warning to resolve by hand.
