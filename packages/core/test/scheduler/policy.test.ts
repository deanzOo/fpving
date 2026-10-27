import { describe, expect, it } from "vitest";
import { err, nextScanDue, ok, PortErrorKind, RatesRefresh, refreshRatesIfStale } from "../../src/index.ts";
import type { FxTable, RatesUnavailable, Result } from "../../src/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeCurrencyRates } from "../fakes/fake-rates.ts";
import { fakeLogger } from "../fakes/fake-logger.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const HOUR_MS = 3_600_000;
const INTERVAL_HOURS = 12;
const ILS_PER_USD = 3.6;

describe("The next scan due time", () => {
  it("is due now when there was no previous scan", () => {
    expect(nextScanDue(null, INTERVAL_HOURS, NOW)).toEqual(NOW);
  });

  it("is due one interval after the last scan", () => {
    const last = new Date(NOW.getTime() - HOUR_MS);
    expect(nextScanDue(last, INTERVAL_HOURS, NOW)).toEqual(new Date(last.getTime() + INTERVAL_HOURS * HOUR_MS));
  });

  it("is due exactly now when the last scan was one interval ago", () => {
    const last = new Date(NOW.getTime() - INTERVAL_HOURS * HOUR_MS);
    expect(nextScanDue(last, INTERVAL_HOURS, NOW)).toEqual(NOW);
  });

  it("is due in a millisecond when the last scan was just under one interval ago", () => {
    const last = new Date(NOW.getTime() - INTERVAL_HOURS * HOUR_MS + 1);
    expect(nextScanDue(last, INTERVAL_HOURS, NOW).getTime()).toBe(NOW.getTime() + 1);
  });
});

const table = (fetchedOn: string, usd = 1): FxTable => ({ base: "USD", ratesPerBase: { ILS: usd }, fetchedOn });
const FRESH = table("2026-10-27", ILS_PER_USD);
const UNAVAILABLE = err({ kind: PortErrorKind.RatesUnavailable, detail: "offline" });

const setup = async (stored: FxTable | null, answer: Result<FxTable, RatesUnavailable> = ok(FRESH)) => {
  const repository = inMemoryRepository();
  if (stored !== null) {
    await repository.fxRates.save(stored);
  }
  const logger = fakeLogger();
  const deps = { repository, rates: fakeCurrencyRates(answer), clock: fakeClock(NOW), logger };
  return { deps, repository, logger };
};

describe("Refreshing stale exchange rates", () => {
  it("fetches and saves rates when none are stored", async () => {
    const { deps, repository } = await setup(null);
    expect(await refreshRatesIfStale(deps)).toBe(RatesRefresh.Refreshed);
    expect(await repository.fxRates.latest()).toEqual(FRESH);
  });

  it("keeps rates published today without fetching", async () => {
    const { deps, repository } = await setup(table("2026-10-27"), ok(table("2026-10-28")));
    expect(await refreshRatesIfStale(deps)).toBe(RatesRefresh.Fresh);
    expect((await repository.fxRates.latest())?.fetchedOn).toBe("2026-10-27");
  });

  it("keeps rates exactly one day old, measured from the start of their published day", async () => {
    const { deps } = await setup(table("2026-10-26"));
    expect(await refreshRatesIfStale({ ...deps, clock: fakeClock(new Date("2026-10-27T00:00:00.000Z")) })).toBe(
      RatesRefresh.Fresh,
    );
  });

  it("refreshes rates a millisecond over one day old", async () => {
    const { deps, repository } = await setup(table("2026-10-26"));
    const clock = fakeClock(new Date("2026-10-27T00:00:00.001Z"));
    expect(await refreshRatesIfStale({ ...deps, clock })).toBe(RatesRefresh.Refreshed);
    expect(await repository.fxRates.latest()).toEqual(FRESH);
  });

  it("refreshes stored rates whose date cannot be read", async () => {
    const { deps } = await setup(table("garbage"));
    expect(await refreshRatesIfStale(deps)).toBe(RatesRefresh.Refreshed);
  });

  it("logs a failed fetch and keeps the last rates", async () => {
    const stored = table("2026-10-20");
    const { deps, repository, logger } = await setup(stored, UNAVAILABLE);
    expect(await refreshRatesIfStale(deps)).toBe(RatesRefresh.Failed);
    expect(await repository.fxRates.latest()).toEqual(stored);
    expect(logger.warnings).toEqual([
      { message: "exchange rates could not be refreshed, using the last ones", fields: { detail: "offline" } },
    ]);
  });

  it("reports a failed fetch when no rates were ever stored", async () => {
    const { deps, repository } = await setup(null, UNAVAILABLE);
    expect(await refreshRatesIfStale(deps)).toBe(RatesRefresh.Failed);
    expect(await repository.fxRates.latest()).toBeNull();
  });
});
