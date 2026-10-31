---
title: "0027. The already_tracked error names the product"
description: The one error kind whose reply carries a field beyond kind and message, so the UI can link to the product that already tracks a URL.
---

- Status: Accepted
- Date: 2026-10-31
- Amends [ADR 0024](../0024-http-api-error-envelope-and-route-table/): the `already_tracked` reply also carries the product; every other reply keeps its shape.

## Context and problem statement

Pasting a URL that a listing already tracks answers 409 `already_tracked`. The UI should say which product watches the page and link to it, but the envelope only had a message, and parsing an id out of prose is what the envelope exists to avoid. Core's `AlreadyTracked` error already holds the product.

## Considered options

- Keep the envelope and let the UI parse the message. Rejected: prose is not a contract.
- An optional `product` on every error. Rejected: every other kind would allow a field that never applies, and a reply missing it could not be told from a valid one.
- A `product: { id, name }` field on the `already_tracked` reply only, with the envelope's `error` a discriminated union on `kind`. Chosen.

## Decision outcome

`apiErrorSchema` in `apps/fpving/src/server/errors.ts` is `{ error }`, where `error` is a Zod discriminated union on `kind`: `{ kind: "already_tracked", message, product: { id, name } }`, or `{ kind, message }` with any other kind. `apiError` builds the second and `alreadyTrackedError` the first. Every route that can answer `already_tracked`, adding a product, adding a listing and accepting a candidate, fills `product` from core's error. The generated HTTP API reference shows both branches. The UI client parses an `already_tracked` reply into a failure that carries the product, and a 409 whose body misses it is a `bad_response`.

## Consequences

- Good: the UI links to the product that tracks a URL without reading prose.
- Good: a reply of the wrong shape for its kind fails the schema on both sides.
- Bad: one kind has a different shape, so code that builds error replies picks the builder by kind.
