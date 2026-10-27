import { err, fxTableSchema, ok, PortErrorKind } from "@fpving/core";
import type { CurrencyRates, FxTable, RatesUnavailable, Result } from "@fpving/core";
import { currencyCodeSchema } from "@fpving/plugin-sdk";
import { z } from "zod";

/** The Frankfurter endpoint for the latest European Central Bank reference rates; free, no key. */
export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";

/** How long a rates request may take before it is abandoned. */
export const FX_TIMEOUT_MS = 10_000;

/** The part of `fetch` the adapter uses, so tests can inject a fake. */
export type FetchFx = (url: string, init: RequestInit) => Promise<Response>;

const frankfurterSchema = z
  .object({ base: currencyCodeSchema, date: z.iso.date(), rates: z.record(z.string(), z.number()) })
  .transform(({ base, date, rates }) => ({
    base,
    fetchedOn: date,
    ratesPerBase: Object.fromEntries(
      Object.entries(rates).filter(([code]) => currencyCodeSchema.safeParse(code).success),
    ),
  }))
  .pipe(fxTableSchema);

const unavailable = (detail: string): Result<never, RatesUnavailable> =>
  err({ kind: PortErrorKind.RatesUnavailable, detail });

const describeIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ");

/**
 * Creates the core {@link CurrencyRates} on the Frankfurter API. The table is based on EUR, the source's base;
 * rates for codes the app does not know are dropped, and the body is validated with the core `fxTableSchema`.
 *
 * @param fetchFx - Sends the request, normally the global `fetch`.
 * @returns The rates source.
 */
export const createHttpFxRates = (fetchFx: FetchFx): CurrencyRates => ({
  fetchLatest: async (): Promise<Result<FxTable, RatesUnavailable>> => {
    let body: unknown;
    try {
      const response = await fetchFx(FRANKFURTER_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FX_TIMEOUT_MS),
      });
      if (!response.ok) {
        return unavailable(`HTTP ${String(response.status)}`);
      }
      body = await response.json();
    } catch (error) {
      return unavailable(`request failed: ${String(error)}`);
    }
    const parsed = frankfurterSchema.safeParse(body);
    return parsed.success ? ok(parsed.data) : unavailable(describeIssues(parsed.error));
  },
});
