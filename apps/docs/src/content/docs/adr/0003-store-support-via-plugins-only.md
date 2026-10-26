---
title: "0003. Store support via plugins only"
description: Store support via plugins only.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Scraping stores is fragile and each site has its own terms of service. The public repository should not ship scrapers for specific shops.

## Considered options

- Ship store integrations in the repository.
- Ship a few examples and accept store pull requests.
- Define a plugin contract and ship no store plugins.

## Decision outcome

Store support comes exclusively from plugins built against `@fpving/plugin-sdk`. The public repository ships none. CI exercises plugin loading end to end with a test-only fixture plugin.

## Consequences

- Good: the project stays out of per-site maintenance and terms-of-service questions.
- Good: the plugin contract is forced to be a real, documented public API.
- Bad: a fresh install watches nothing until the user installs plugins.
- Plugins are for personal use and the docs say so.
