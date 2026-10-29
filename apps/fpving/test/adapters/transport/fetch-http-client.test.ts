import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchHttpClient,
  HTTP_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
} from "../../../src/adapters/transport/fetch-http-client.ts";
import type { FetchFn } from "../../../src/adapters/transport/fetch-http-client.ts";
import type { DomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";

const USER_AGENT = "fpving/9.9.9 (+https://example.test)";
const NOT_FOUND = 404;
const OK = 200;
const CUSTOM_TIMEOUT_MS = 1234;
const FOUND = 302;
const NOT_MODIFIED = 304;
const NO_CONTENT = 204;
const HALF = 2;
const PULLS_TO_EXCEED_CAP = 2;

const passThrough: DomainLimiter = { run: (_url, task) => task() };

const recording = (reply: () => Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchFn = (url, init) => {
    requests.push({ url, init });
    return reply();
  };
  return { requests, client: createFetchHttpClient({ fetch: fetchFn, limiter: passThrough, userAgent: USER_AGENT }) };
};

const replying = (...replies: (() => Response)[]) =>
  recording(() => {
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return Promise.resolve(reply ? reply() : new Response(""));
  });

const redirectTo = (location: string) => (): Response =>
  new Response(null, { status: FOUND, headers: { location } });

const headerOf = (init: RequestInit | undefined, name: string): string | null => new Headers(init?.headers).get(name);

const REFUSED_URLS = [
  "file:///etc/passwd",
  "ftp://shop.example/file",
  "data:text/html,hi",
  "javascript:alert(1)",
  "http://localhost/",
  "http://127.0.0.1/",
  "http://10.1.2.3/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Plain HTTP access for plugins", () => {
  it("returns the status, body and lowercased headers of a response", async () => {
    const { client } = recording(() =>
      Promise.resolve(
        new Response("hello", { status: OK, headers: { "Content-Type": "text/plain", "X-Shop": "yes" } }),
      ),
    );
    expect(await client.get("https://shop.example/a")).toEqual({
      ok: true,
      value: { status: OK, body: "hello", headers: { "content-type": "text/plain", "x-shop": "yes" } },
    });
  });

  it("returns a 404 as a response, not an error", async () => {
    const { client } = recording(() => Promise.resolve(new Response("gone", { status: NOT_FOUND })));
    const result = await client.get("https://shop.example/missing");
    expect(result).toMatchObject({ ok: true, value: { status: NOT_FOUND, body: "gone" } });
  });

  it("sends the fixed user agent, overriding one a plugin supplies", async () => {
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    await client.get("https://shop.example/a", { headers: { "User-Agent": "evil/1", "Accept": "application/json" } });
    expect(headerOf(requests[0]?.init, "user-agent")).toBe(USER_AGENT);
    expect(headerOf(requests[0]?.init, "accept")).toBe("application/json");
  });

  it("sends the user agent when the plugin gives no options", async () => {
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    await client.get("https://shop.example/a");
    expect(headerOf(requests[0]?.init, "user-agent")).toBe(USER_AGENT);
    expect(requests[0]?.url).toBe("https://shop.example/a");
  });

  it.each([
    ["a header name with a space", { "Bad Header": "x" }],
    ["a header value with a newline", { "X-Shop": "a\nb" }],
  ])("returns a network error for %s without fetching", async (_label, headers) => {
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    const result = await client.get("https://shop.example/a", { headers });
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(requests).toEqual([]);
  });

  it("puts the default deadline on every request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    await client.get("https://shop.example/a");
    expect(timeout).toHaveBeenCalledWith(HTTP_TIMEOUT_MS);
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the deadline it is configured with", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const custom = createFetchHttpClient({
      fetch: () => Promise.resolve(new Response("")),
      limiter: passThrough,
      userAgent: USER_AGENT,
      timeoutMs: CUSTOM_TIMEOUT_MS,
    });
    await custom.get("https://shop.example/a");
    expect(timeout).toHaveBeenCalledWith(CUSTOM_TIMEOUT_MS);
  });

  it.each(REFUSED_URLS)("refuses %s as a network error before limiting or fetching", async (url) => {
    let limited = false;
    let fetched = false;
    const client = createFetchHttpClient({
      fetch: () => {
        fetched = true;
        return Promise.resolve(new Response(""));
      },
      limiter: {
        run: (_url, task) => {
          limited = true;
          return task();
        },
      },
      userAgent: USER_AGENT,
    });
    expect(await client.get(url)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(limited).toBe(false);
    expect(fetched).toBe(false);
  });

  it("fetches the normalized url, not the plugin's raw string", async () => {
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    await client.get("HTTPS://Shop.Example:443/a b");
    expect(requests[0]?.url).toBe("https://shop.example/a%20b");
  });

  it("explains why a url was refused", async () => {
    const { client } = recording(() => Promise.resolve(new Response("")));
    const result = await client.get("file:///etc/passwd");
    expect(result).toEqual({
      ok: false,
      error: { kind: "network", detail: "refused: only http and https urls are allowed, got file:" },
    });
  });

  it("lets a private host through only when private hosts are allowed", async () => {
    const client = createFetchHttpClient({
      fetch: () => Promise.resolve(new Response("local")),
      limiter: passThrough,
      userAgent: USER_AGENT,
      allowPrivateHosts: true,
    });
    expect(await client.get("http://127.0.0.1:8080/")).toMatchObject({ ok: true, value: { body: "local" } });
  });

  it("maps an elapsed deadline to a timeout error", async () => {
    const { client } = recording(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    const result = await client.get("https://shop.example/a");
    expect(result).toEqual({ ok: false, error: { kind: "timeout", detail: "TimeoutError: timed out" } });
  });

  it("maps any other failure to a network error", async () => {
    const { client } = recording(() => Promise.reject(new TypeError("fetch failed")));
    const result = await client.get("https://shop.example/a");
    expect(result).toEqual({ ok: false, error: { kind: "network", detail: "TypeError: fetch failed" } });
  });

  it("maps a body that fails to download to a network error", async () => {
    const broken = new Response(
      new ReadableStream({
        pull: (controller) => {
          controller.error(new Error("socket hang up"));
        },
      }),
    );
    const { client } = recording(() => Promise.resolve(broken));
    const result = await client.get("https://shop.example/a");
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("sends each request through the limiter keyed by its url", async () => {
    const seen: string[] = [];
    const limiter: DomainLimiter = {
      run: (url, task) => {
        seen.push(url);
        return task();
      },
    };
    const client = createFetchHttpClient({
      fetch: () => Promise.resolve(new Response("")),
      limiter,
      userAgent: USER_AGENT,
    });
    await client.get("HTTPS://Shop.Example/a");
    expect(seen).toEqual(["https://shop.example/a"]);
  });

  it("follows redirects itself instead of letting fetch follow them unchecked", async () => {
    const { client, requests } = replying(() => new Response(""));
    await client.get("https://shop.example/a");
    expect(requests[0]?.init.redirect).toBe("manual");
  });

  it("follows a relative redirect, resolved against the url that sent it", async () => {
    const { client, requests } = replying(redirectTo("../b?x=1"), () => new Response("moved here"));
    const result = await client.get("https://shop.example/a/c");
    expect(requests.map((request) => request.url)).toEqual(["https://shop.example/a/c", "https://shop.example/b?x=1"]);
    expect(result).toMatchObject({ ok: true, value: { status: OK, body: "moved here" } });
  });

  it("refuses a redirect to a private host without requesting it", async () => {
    const { client, requests } = replying(redirectTo("http://127.0.0.1/admin"));
    const result = await client.get("https://shop.example/a");
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(result.ok ? "" : result.error.detail).toMatch(/^refused: .*; redirect to http:\/\/127\.0\.0\.1\/admin$/);
    expect(requests).toHaveLength(1);
  });

  it("gives up with a network error after too many redirects", async () => {
    const { client, requests } = replying(redirectTo("/again"));
    const result = await client.get("https://shop.example/a");
    expect(result).toEqual({ ok: false, error: { kind: "network", detail: "too many redirects" } });
    expect(requests).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("returns a redirect status without a location as the response", async () => {
    const { client } = replying(() => new Response(null, { status: NOT_MODIFIED }));
    expect(await client.get("https://shop.example/a")).toMatchObject({ ok: true, value: { status: NOT_MODIFIED } });
  });

  it("reads a body of exactly the size cap", async () => {
    const { client } = replying(() => new Response("a".repeat(MAX_BODY_BYTES)));
    const result = await client.get("https://shop.example/a");
    expect(result.ok ? result.value.body.length : 0).toBe(MAX_BODY_BYTES);
  });

  it("stops reading a body over the size cap and reports it as a network error", async () => {
    let cancelled = false;
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES / HALF + 1));
      },
      cancel: () => {
        cancelled = true;
      },
    });
    const { client } = replying(() => new Response(endless));
    const result = await client.get("https://shop.example/a");
    expect(result).toEqual({ ok: false, error: { kind: "network", detail: "response too large" } });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(PULLS_TO_EXCEED_CAP + 1);
  });

  it("decodes a utf-8 character split across two chunks", async () => {
    const euro = new TextEncoder().encode("€");
    const split = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(euro.slice(0, 1));
        controller.enqueue(euro.slice(1));
        controller.close();
      },
    });
    const { client } = replying(() => new Response(split));
    expect(await client.get("https://shop.example/a")).toMatchObject({ ok: true, value: { body: "€" } });
  });

  it("reads a response without a body as an empty body", async () => {
    const { client } = replying(() => new Response(null, { status: NO_CONTENT }));
    expect(await client.get("https://shop.example/a")).toMatchObject({ ok: true, value: { body: "" } });
  });

  it("reports a body stream that yields something other than bytes as a network error", async () => {
    const strings = new ReadableStream<string>({
      start: (controller) => {
        controller.enqueue("not bytes");
      },
    });
    const { client } = replying(() => Object.defineProperty(new Response(""), "body", { value: strings }));
    const result = await client.get("https://shop.example/a");
    expect(result).toEqual({ ok: false, error: { kind: "network", detail: "response body is not bytes" } });
  });

  const CREDENTIALS = { "Authorization": "Bearer t", "Proxy-Authorization": "Basic p", "Cookie": "session=1" };
  const credentialsSent = (init: RequestInit | undefined): (string | null)[] =>
    ["authorization", "proxy-authorization", "cookie"].map((name) => headerOf(init, name));

  it("keeps the plugin's credentials on a redirect to the same origin", async () => {
    const { client, requests } = replying(redirectTo("/b"), () => new Response(""));
    await client.get("https://shop.example/a", { headers: CREDENTIALS });
    expect(credentialsSent(requests[1]?.init)).toEqual(["Bearer t", "Basic p", "session=1"]);
  });

  it.each(["https://other.example/b", "http://shop.example/b", "https://shop.example:8443/b"])(
    "drops the plugin's credentials on a redirect to the other origin %s, and keeps the rest",
    async (location) => {
      const { client, requests } = replying(redirectTo(location), redirectTo("/c"), () => new Response(""));
      await client.get("https://shop.example/a", { headers: { ...CREDENTIALS, Accept: "text/html" } });
      expect(credentialsSent(requests[0]?.init)).toEqual(["Bearer t", "Basic p", "session=1"]);
      expect(credentialsSent(requests[1]?.init)).toEqual([null, null, null]);
      expect(credentialsSent(requests.at(-1)?.init)).toEqual([null, null, null]);
      expect(headerOf(requests[1]?.init, "accept")).toBe("text/html");
      expect(headerOf(requests[1]?.init, "user-agent")).toBe(USER_AGENT);
    },
  );

  it("does not restore the plugin's credentials when a redirect chain returns to the first origin", async () => {
    const back = redirectTo("https://shop.example/c");
    const { client, requests } = replying(redirectTo("https://other.example/b"), back, () => new Response(""));
    await client.get("https://shop.example/a", { headers: CREDENTIALS });
    const chain = ["https://shop.example/a", "https://other.example/b", "https://shop.example/c"];
    expect(requests.map(({ url }) => url)).toEqual(chain);
    expect(credentialsSent(requests.at(-1)?.init)).toEqual([null, null, null]);
  });

  it("forwards a custom header such as x-api-key on a redirect to another origin, as fetch does", async () => {
    const { client, requests } = replying(redirectTo("https://other.example/b"), () => new Response(""));
    await client.get("https://shop.example/a", { headers: { "x-api-key": "k" } });
    expect(headerOf(requests[1]?.init, "x-api-key")).toBe("k");
  });
});
