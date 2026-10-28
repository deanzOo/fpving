import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchHttpClient, HTTP_TIMEOUT_MS } from "../../../src/adapters/transport/fetch-http-client.ts";
import type { FetchFn } from "../../../src/adapters/transport/fetch-http-client.ts";
import type { DomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";

const USER_AGENT = "fpving/9.9.9 (+https://example.test)";
const NOT_FOUND = 404;
const OK = 200;
const CUSTOM_TIMEOUT_MS = 1234;

const passThrough: DomainLimiter = { run: (_url, task) => task() };

const recording = (reply: () => Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchFn = (url, init) => {
    requests.push({ url, init });
    return reply();
  };
  return { requests, client: createFetchHttpClient({ fetch: fetchFn, limiter: passThrough, userAgent: USER_AGENT }) };
};

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
});
