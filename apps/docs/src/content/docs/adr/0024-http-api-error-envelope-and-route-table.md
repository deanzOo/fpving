---
title: "0024. HTTP API error envelope and one route table"
description: One shape for every error reply, and route schemas kept in one table that both registers the routes and generates their reference page.
---

- Status: Accepted
- Date: 2026-10-30
- Supersedes the error reply bodies in [ADR 0023](../0023-fastify-server-with-a-localhost-guard/); its guards, statuses and masking rules stand.

## Context and problem statement

The domain routes need a way to say why a request was refused that the UI can branch on without parsing prose, and the shell already answered refusals in three ad hoc shapes. The routes also need documentation that cannot drift from what they accept and answer.

## Considered options

- Fastify's default error body (`statusCode`, `error`, `message`). Rejected: no stable machine-readable reason, and domain refusals are replies, not thrown errors.
- RFC 9457 problem details. Rejected: more fields than a local single-user app needs, and a media type the UI would have to special-case.
- `{ "error": { "kind", "message" } }` with `kind` from one `as const` object. Chosen.
- `@fastify/swagger` for the reference. Rejected: a new dependency and a served OpenAPI document the app does not need; Zod's own `toJSONSchema` renders the same schemas.

## Decision outcome

Every error reply, from the guards, the readiness gate, Fastify's own 4xx, an unknown path, an unexpected error or a domain refusal, is `{ "error": { "kind", "message" } }`. `ApiErrorKind` in `apps/fpving/src/server/errors.ts` lists every kind: the shell's (`misdirected_request`, `cross_origin`, `starting`, `invalid_request`, `request_refused`, `internal`, `not_found`), core's add and match error kinds reused as they are (`invalid_url`, `no_plugin_for_domain`, `already_tracked`, `fetch_failed`, `product_not_found`, `no_source_listing`, `not_pending`, `already_suggested`), `plugin_unavailable` for a URL whose plugin is not loaded, and `scan_running`. `message` is one line for the user and never internal detail. Handlers map each core `Result` to a typed reply and never throw for a refusal; only bugs reach the 500 handler.

`apiRoutes` in `apps/fpving/src/server/api-routes.ts` holds every domain route's method, path, summary and Zod schemas for params, query, body and each answer by status, built from core's and the SDK's entity schemas. The routes are registered from it, so the type provider types each handler and refuses a status the table does not declare, and `pnpm docs:spec` renders it into the generated HTTP API reference page with `z.toJSONSchema`. Routes register before `listen` and read the running app through `attach`, behind the readiness gate. No route changes state on GET.

## Consequences

- Good: the UI switches on `kind`; a new refusal is a compile error until it is in the table and in `ApiErrorKind`.
- Good: the reference page is regenerated on every docs build.
- Bad: the generated page is long, because each route's schemas are inlined rather than shared.

Amended by [ADR 0025](../0025-archive-products-and-remove-listings/), which adds error kinds; the page now shows the envelope once.
