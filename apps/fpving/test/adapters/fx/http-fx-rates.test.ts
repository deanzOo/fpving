import { PortErrorKind } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { createHttpFxRates, FRANKFURTER_URL } from "../../../src/adapters/fx/http-fx-rates.ts";
import type { FetchFx } from "../../../src/adapters/fx/http-fx-rates.ts";

const LATEST = { amount: 1, base: "EUR", date: "2026-10-27", rates: { USD: 1.115, ILS: 3.4003, JPY: 175.97 } };
const HTTP_ERROR = 503;

const replying = (body: unknown, init?: ResponseInit) => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFx: FetchFx = (url, requestInit) => {
    requests.push({ url, init: requestInit });
    return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), init));
  };
  return { rates: createHttpFxRates(fetchFx), requests };
};

const detailOf = (result: Awaited<ReturnType<ReturnType<typeof createHttpFxRates>["fetchLatest"]>>): string =>
  result.ok ? "" : result.error.detail;

describe("Fetching exchange rates over HTTP", () => {
  it("maps the published rates into a table based on the source currency", async () => {
    const { rates } = replying(LATEST);
    expect(await rates.fetchLatest()).toEqual({
      ok: true,
      value: { base: "EUR", fetchedOn: "2026-10-27", ratesPerBase: { USD: 1.115, ILS: 3.4003, JPY: 175.97 } },
    });
  });

  it("asks the Frankfurter latest endpoint for JSON with a timeout", async () => {
    const { rates, requests } = replying(LATEST);
    await rates.fetchLatest();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(FRANKFURTER_URL);
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops rates for codes the app does not know", async () => {
    const { rates } = replying({ ...LATEST, rates: { USD: 1.115, XDR: 0.8 } });
    expect(await rates.fetchLatest()).toEqual({
      ok: true,
      value: { base: "EUR", fetchedOn: "2026-10-27", ratesPerBase: { USD: 1.115 } },
    });
  });

  it("reports a non-2xx answer as rates unavailable", async () => {
    const { rates } = replying("down", { status: HTTP_ERROR });
    const result = await rates.fetchLatest();
    expect(result).toEqual({ ok: false, error: { kind: PortErrorKind.RatesUnavailable, detail: "HTTP 503" } });
  });

  it("reports a failed request as rates unavailable", async () => {
    const rates = createHttpFxRates(async () => Promise.reject(new TypeError("fetch failed")));
    const result = await rates.fetchLatest();
    expect(result.ok).toBe(false);
    expect(detailOf(result)).toBe("request failed: TypeError: fetch failed");
  });

  it("reports a body that is not JSON as rates unavailable", async () => {
    const { rates } = replying("<html>");
    const result = await rates.fetchLatest();
    expect(result.ok ? undefined : result.error.kind).toBe(PortErrorKind.RatesUnavailable);
    expect(detailOf(result)).toContain("request failed");
  });

  it.each([
    ["has no date", { base: "EUR", rates: { USD: 1 } }, "date"],
    ["has an unknown base currency", { ...LATEST, base: "XXX" }, "base"],
    ["has a malformed date", { ...LATEST, date: "27/10/2026" }, "date"],
    ["has a non-numeric rate", { ...LATEST, rates: { USD: "1.1" } }, "rates.USD"],
    ["has a rate of zero", { ...LATEST, rates: { USD: 0 } }, "ratesPerBase.USD"],
    ["is not an object", null, "expected object"],
  ])("reports a response that %s as rates unavailable", async (_name, body, mentions) => {
    const { rates } = replying(body);
    const result = await rates.fetchLatest();
    expect(result.ok ? undefined : result.error.kind).toBe(PortErrorKind.RatesUnavailable);
    expect(detailOf(result)).toContain(mentions);
  });
});
