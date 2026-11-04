---
title: "0035. Allowlist headers on cross-origin redirects"
description: Which request headers survive a redirect that leaves the origin.
---

- Status: Accepted
- Date: 2026-11-04
- Amends: [ADR 0019](../0019-playwright-for-the-browser-driver/)

## Context and problem statement

ADR 0019 dropped `authorization`, `proxy-authorization` and `cookie` on a cross-origin redirect and accepted that any other header, such as `x-api-key`, still went to the other origin, as native `fetch` does. A plugin cannot prevent that, because the client always follows redirects, so a secret in a custom header can reach a third-party host a store redirects to.

## Considered options

- Keep ADR 0019's denylist and tell plugin authors not to put secrets in custom headers. It relies on every author reading that line.
- Add a redirect setting to `HttpRequestOptions`. It widens the plugin contract, and each plugin must still remember to use it.
- Keep only an allowlist of headers once a redirect leaves the origin.

## Decision outcome

Once a redirect leaves the origin, `FetchHttpClient` sends only `accept`, `accept-language` and `user-agent`, for the rest of the chain, even if a later redirect returns to the first origin. This replaces ADR 0019's consequence about the three dropped headers.

## Consequences

- Good: no custom header reaches another origin through a redirect.
- Bad: a plugin that needs a custom header on another origin must request that URL itself, and it has no final URL in `HttpResponse` to find it from unless the store exposes it.
