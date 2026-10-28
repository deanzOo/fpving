---
title: "0019. Playwright for the browser driver, with a shared per-host limiter"
description: Why Playwright's Chromium backs the BrowserDriver, how its binary is installed, and how one limiter paces both transports.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

Plugins never bring their own HTTP client or browser; the host injects `HttpClient` and `BrowserDriver`. Some shops render prices with JavaScript, so the host needs a real browser, with one persistent profile it owns and shuts down. It must be polite to shops (no bursts to one host), return typed `timeout` and `network` errors instead of throwing, and be testable without a network or a browser.

## Considered options

- `playwright` (Apache-2.0), Chromium only. Chosen. Maintained by Microsoft, a typed API, `launchPersistentContext` for a profile directory, and exported error classes (`errors.TimeoutError`) so a timeout is recognised by class, not by message.
- `puppeteer` (Apache-2.0). Rejected: comparable, but its persistent profile and typed errors are less direct, and E2E tests (Task 19) will use Playwright anyway, so one tool covers both.
- `playwright-core` plus a system Chrome. Rejected: it depends on whatever the user has installed, and the version would drift from the one tested.
- Launching a browser per request. Rejected: slow, and cookies and storage would not survive between scans.

## Decision outcome

`playwright` 1.64.1 is a runtime dependency of `apps/fpving`, pinned like the others. Only Chromium is used. The package has no install script: it does not download a browser when you run `pnpm install`. The browser binary is installed by an explicit step, `pnpm --filter @fpving/app exec playwright install chromium` (add `--with-deps` on Linux for the system libraries). A host that never loads a JavaScript page never needs it, and a missing binary shows up as a `network` error on the first page, with the launcher's message as the detail.

`PlaywrightBrowserDriver` (`createPlaywrightBrowserDriver`) launches one persistent headless context on the first `fetchPage`, with its profile in an injected directory, and reuses it. If the launch fails the next call tries again. Each page is opened in a new tab, navigated with a thirty second timeout, read for the status of the main response, `page.content()` and `page.url()`, and always closed, including on errors. A navigation that yields no response is a `network` error. A Playwright `TimeoutError` is `timeout`; any other error is `network`. `close()` shuts the context down and is safe to call twice. The browser is reached through a small interface (`LaunchContext` and two handle types) so unit tests use a fake; the real launcher is one line in `launch-chromium.ts`, the only file excluded from coverage, and a real-Chromium integration test covers it.

`FetchHttpClient` (`createFetchHttpClient`) uses an injected `fetch` with `AbortSignal.timeout` (fifteen seconds). Any status, including 404 and 403, is a completed response because plugins decide what it means; an aborted deadline is `timeout` and everything else `network`. The body is read as a stream and capped at five megabytes (`MAX_BODY_BYTES`); a larger one stops reading and is a `network` error, "response too large", so a hostile shop cannot exhaust the host's memory. The user agent is fixed, `fpving/<version> (+https://github.com/deanzOo/fpving)`, replaces any a plugin sets, and takes the version from the app `package.json`.

Plugins are a trust boundary, so both transports share one URL policy (`url-policy.ts`) and apply it before the limiter. Only absolute `http:` and `https:` URLs are allowed, which stops `file:`, `data:`, `javascript:` and similar schemes (a plugin could otherwise read local files through Chromium). Literal private, loopback, link-local and other non-public hosts are refused too: `localhost` and `*.localhost` (any number of trailing dots), 127.0.0.0/8, 0.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, carrier-grade NAT 100.64/10, IETF protocol assignments 192.0.0.0/24, benchmarking 198.18.0.0/15, multicast 224.0.0.0/4, broadcast 255.255.255.255, `::1`, `::`, fc00::/7, fe80::/10, site-local fec0::/10 and multicast ff00::/8, so a plugin cannot reach the host's own API on localhost. IPv6 literals that embed an IPv4 address get the same IPv4 check on the embedded address: IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible `::a.b.c.d`, SIIT `::ffff:0:a.b.c.d` and NAT64 `64:ff9b::a.b.c.d`. The URL parser normalizes forms such as `2130706433` and `0x7f.1` before the check, and both transports hand the parser's normalized `href` to `fetch` and Chromium, never the plugin's raw string, so the check and the request see the same URL. A refusal is a `network` error with a stated reason. `allowPrivateHosts` (default false) exists only so the integration tests can reach the 127.0.0.1 fixture server.

The policy also covers traffic the plugin did not name. `FetchHttpClient` follows redirects itself (`redirect: "manual"`, at most ten), resolves each `Location` against the URL that sent it and checks it like the first URL, so a redirect to a private host is refused before it is requested. Like native `fetch`, it stops sending `authorization`, `proxy-authorization` and `cookie` once a redirect leaves the origin (scheme, host and port), so a plugin's credentials never reach a third party. The browser context routes every HTTP request a page starts, its subresources, XHR and `fetch`, through the policy and aborts the refused ones. Playwright routes WebSockets separately, so `routeWebSocket` checks every WebSocket a page opens with `checkWebSocketUrl`, which allows only `ws:` and `wss:` and checks the host as for `http:` and `https:`; a refused one is closed before it connects. Chromium launches with service workers blocked, because Playwright does not route requests a service worker makes. Redirect hops are the one exception: Playwright does not route them, so the driver checks where a navigation landed and returns a `network` error instead of a page from a refused host.

The remaining risk is DNS rebinding: a public name that resolves to a private address passes, because the policy sees host names, not the addresses they resolve to. One narrower gap stays in the browser: a redirect hop from a public URL to a private one is still sent, because Playwright never shows it to the route, but its response never reaches the plugin. Closing both would take a filtering proxy that checks resolved addresses. The API therefore cannot rely on the transports alone and must defend itself (see the [architecture](../../architecture/)).

`close()` is final. After it, `fetchPage` returns a `network` error ("browser closed") and never launches again; a launch still in flight when `close()` is called is closed once it settles, and a failed one is ignored because there is nothing to close.

One `DomainLimiter` is shared by both transports and keyed on the hostname. It serializes requests to a host and starts each at least two seconds plus up to one second of random jitter after the previous start; different hosts run in parallel. It covers the start of each request or navigation the plugin asks for, not redirects to other hosts or the subresources (scripts, images, XHR) a page loads in the browser. Its clock, timer and random source are injected, so tests never sleep. A rejected task does not block later requests.

Chromium is installed in the Linux job of the `check` workflow only, and the browser integration test is required there (`FPVING_REQUIRE_BROWSER=1` makes a missing binary a failure instead of a skip), so it cannot be skipped forever without anyone noticing. macOS and Windows jobs and local machines without the binary skip it with a stated reason; the unit tests with the fake keep coverage at 100% everywhere. The download is cached by Playwright version, so a run downloads Chromium only when the locked Playwright version changes; the later E2E job needs the same binary.

## Consequences

- Good: JavaScript-rendered shops are reachable, with a profile that keeps cookies between scans.
- Good: the limiter is one module for both transports, so a shop is never hit by a request and a page load at once.
- Good: no network and no browser needed for the unit suite.
- Bad: a large runtime dependency, and a separate browser download of a few hundred megabytes before the first JavaScript page works.
- Bad: the browser integration test does not run on macOS or Windows CI, so it covers Chromium on Linux only.
- Bad: one cookie and storage profile is shared by all stores and plugins, so a site can correlate visits and one plugin's cookies reach another's pages. The profile directory holds session cookies, so treat `DATA_DIR` as sensitive.
- Bad: the limiter is per process; two fpving processes sharing a profile would not coordinate.
