import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";
import { createFetchHttpClient } from "../../../src/adapters/transport/fetch-http-client.ts";
import { createUserAgent, readAppVersion } from "../../../src/adapters/transport/user-agent.ts";
import { FIXTURE_HTML, NOT_FOUND, startLocalServer } from "../../support/local-server.ts";
import type { LocalServer } from "../../support/local-server.ts";

const SHORT_TIMEOUT_MS = 100;
const OK = 200;

const instant = createDomainLimiter({ now: () => Date.now(), sleep: () => Promise.resolve(), random: () => 0 });
const userAgent = createUserAgent(readAppVersion());

describe("The HTTP client against a local server", () => {
  let server: LocalServer;

  beforeAll(async () => {
    server = await startLocalServer();
  });

  afterAll(async () => {
    await server.close();
  });

  const client = (timeoutMs?: number) =>
    createFetchHttpClient({ fetch, limiter: instant, userAgent, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  it("fetches a page with its status, body and lowercased headers", async () => {
    const result = await client().get(`${server.origin}/page`);
    expect(result).toMatchObject({
      ok: true,
      value: { status: OK, body: FIXTURE_HTML, headers: { "x-fixture": "yes" } },
    });
  });

  it("follows a redirect to the page", async () => {
    const result = await client().get(`${server.origin}/redirect`);
    expect(result).toMatchObject({ ok: true, value: { status: OK, body: FIXTURE_HTML } });
  });

  it("returns a 404 as a response", async () => {
    const result = await client().get(`${server.origin}/missing`);
    expect(result).toMatchObject({ ok: true, value: { status: NOT_FOUND, body: "nothing here" } });
  });

  it("identifies itself with the fpving user agent", async () => {
    const result = await client().get(`${server.origin}/echo-user-agent`);
    expect(result).toMatchObject({ ok: true, value: { body: userAgent } });
    expect(userAgent).toMatch(/^fpving\/\S+ \(\+https:\/\/github\.com\/deanzOo\/fpving\)$/);
  });

  it("times out on a server that never answers", async () => {
    const result = await client(SHORT_TIMEOUT_MS).get(`${server.origin}/hang`);
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("reports a refused connection as a network error", async () => {
    const closed = await startLocalServer();
    await closed.close();
    const result = await client().get(`${closed.origin}/page`);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
  });
});
