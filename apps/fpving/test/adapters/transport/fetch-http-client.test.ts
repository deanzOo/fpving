import { describe, expect, it } from "vitest";
import { createFetchHttpClient, HTTP_TIMEOUT_MS } from "../../../src/adapters/transport/fetch-http-client.ts";
import type { FetchFn } from "../../../src/adapters/transport/fetch-http-client.ts";
import type { DomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";

const USER_AGENT = "fpving/9.9.9 (+https://example.test)";
const NOT_FOUND = 404;
const OK = 200;

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

  it("puts a deadline on every request", async () => {
    const { client, requests } = recording(() => Promise.resolve(new Response("")));
    await client.get("https://shop.example/a");
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(HTTP_TIMEOUT_MS).toBeGreaterThan(0);
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
      timeoutMs: HTTP_TIMEOUT_MS,
    });
    await client.get("https://shop.example/a");
    expect(seen).toEqual(["https://shop.example/a"]);
  });
});
