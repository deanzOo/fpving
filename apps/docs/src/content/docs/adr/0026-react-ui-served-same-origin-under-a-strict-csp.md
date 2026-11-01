---
title: "0026. React UI on Vite, served on the same origin under a strict CSP"
description: The UI stack, how its client is typed from the route table, how it is tested, and how the server serves it.
---

- Status: Accepted
- Date: 2026-10-31
- Amends [ADR 0023](../0023-fastify-server-with-a-localhost-guard/): the readiness gate covers `/api` paths only, so the UI loads while the app starts.

## Context and problem statement

The JSON API exists ([ADR 0024](../0024-http-api-error-envelope-and-route-table/)) and the UI is a React app in the browser ([ADR 0002](../0002-local-web-app-over-desktop-shell/)). It needs a build, routing, data fetching, styling, a chart for the price trend, tests that run real DOM and layout, a client whose types cannot drift from the server, and a way to be served that keeps the `Host` and `Origin` guards meaningful.

## Considered options

- Package layout: the UI inside `apps/fpving`, or its own workspace package. Chosen: `apps/ui` (`@fpving/ui`, private), so its browser `tsconfig` (DOM types, JSX, bundler resolution) and its dependencies stay out of the Node host. Vite builds it into `apps/ui/dist/web`, which the host serves.
- Build: Vite 8 with `@vitejs/plugin-react`. Chosen; the alternatives (webpack, Parcel) need more configuration for the same output.
- Routing: React Router, or TanStack Router 1. Chosen: TanStack Router, with code-defined routes and no file-based code generation; links and params are typed from the route tree.
- Data: hand-written effects, or TanStack Query 5. Chosen: TanStack Query, for caching, invalidation after a change and error states.
- Styling: CSS modules, or Tailwind CSS 4 through `@tailwindcss/vite`. Chosen: Tailwind; colours are theme tokens defined once and redefined under `prefers-color-scheme: dark`.
- Charts: hand-drawn SVG, or Recharts 3. Chosen: Recharts. The sparkline is a 2px line with no axes; a day without a price stays a gap (`connectNulls` off), a priced day with no priced neighbour is a dot, and hovering, or focusing the chart and pressing the arrow keys (Recharts' accessibility layer), shows each day's price. The chart's accessible name sums the range up.
- Typed client: OpenAPI code generation, a hand-written client, or deriving from the route table. Chosen: derive. `@fpving/app` exports `api-routes`, `errors` and `http-status` as subpaths (the status table moved to its own module so the route table pulls no Fastify code into the browser). Request types are `z.input` of the route schemas; each answer is parsed with the route's schema for its status. JSON carries dates as ISO strings while the schemas say `z.date()`, so the client first revives strings into dates along the schema (objects, arrays, nullables) and then parses; a shape it does not walk is left alone and the parse rejects it. An error answer parses as the envelope into an `ApiFailure` with the server's kind; a network failure is `unreachable`, a body outside the schemas `bad_response`. The client is one small function per route the UI calls, which keeps every answer type exact without casts.
- Tests: jsdom, or Vitest browser mode on Playwright Chromium (`@vitest/browser-playwright`, `vitest-browser-react`). Chosen: browser mode, the `ui` project of `pnpm test`, inside the 100% coverage gate; Playwright is already a dependency. Components get a client over a scripted in-memory transport through React context, so there is no network and no MSW; the fake encodes answers with the route schemas exactly as the server's serializer does.
- Serving: a separate static server or the Vite preview, or the host. Chosen: the host, with `@fastify/static` 10.

## Decision outcome

`createServer` takes the UI folder. A GET or HEAD outside `/api` serves the file it names, never a dotfile, or `index.html` when none matches so client routes work on reload, or a 404 `the UI is not built; run pnpm build` when the folder had no index page when the server was created. Whether a request is an `/api` one is decided on its percent-decoded path, as the router matches it, so `/%61pi/...` is gated like `/api/...`. The UI goes through the same `onRequest` hook as the API, so the `Host` guard refuses a rebinding name before any file is served. Every answer carries `Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Vite's build emits only an external module script and stylesheet, no inline script or style element; React sets styles through the DOM, which a CSP allows. Zod probes `new Function` before compiling fast validators, which the policy reports as a violation, so the page sets Zod's `jitless` option before anything parses. The readiness gate now applies to `/api` paths only: the UI loads while the app starts and shows the API's `starting` error with a retry.

`pnpm dev` runs `tsc -b` and then `tools/dev-cli.ts`, which starts Vite through its API with a proxy that forwards `/api` to the worktree's app on `PORT`, read from `.env` through the app's `parseEnv` (a variable set in the shell wins; an invalid value fails without echoing any value). `changeOrigin` makes the `Host` header `127.0.0.1:PORT`. Only a request whose `Origin` is the dev page's own, `http://<its Host>`, gets `Origin: http://127.0.0.1:PORT`; any other `Origin` is passed on, so the app still refuses another site's changes, and Vite's own allowed-hosts check refuses a rebinding name. The guards themselves are unchanged. The proxy is passed in by that script rather than built in `vite.config.ts`, so the config imports no workspace package and loads before any build; a tooling test checks every config file for that. CI installs Chromium on all three operating systems for the `ui` project, through one composite action that the check matrix and the docs job share.

Every new direct dependency is MIT licensed except `playwright`, a devDependency of `@fpving/ui` for the browser tests, which is Apache-2.0; both are compatible with AGPL-3.0, and `pnpm licenses:check` passes with them.

## Consequences

- Good: a server change to a route schema changes the UI's types and its runtime parsing together.
- Good: one origin, so no CORS, and the guards and CSP cover the UI as well as the API.
- Good: component tests run real layout and SVG, so the sparkline's gaps and tooltip are tested as drawn.
- Bad: the host finds the UI at `apps/ui/dist/web` relative to its own files, which assumes the monorepo layout; packaging the app will need another way to locate it.
- Bad: the UI bundle is one chunk of about 800 kB, mostly React, Recharts and Zod; Vite warns about it. It loads from localhost, so splitting it waits until it matters.
- Bad: the browser tests need a Chromium download on every CI runner, cached per OS.
