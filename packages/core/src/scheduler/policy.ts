import type { Clock, Logger } from "@fpving/plugin-sdk";
import type { CurrencyRates } from "../ports/currency-rates.js";
import type { Repository } from "../ports/repository.js";

/** How many milliseconds are in an hour. */
export const MS_PER_HOUR = 3_600_000;

const HOURS_PER_DAY = 24;

const FX_MAX_AGE_MS = HOURS_PER_DAY * MS_PER_HOUR;

/**
 * When the next scan is due: one interval after `lastScanAt`, or `now` when there was no previous scan. A result
 * at or before `now` means the scan is overdue.
 *
 * @param lastScanAt - When the last scan started, or null when none ran.
 * @param intervalHours - The scan interval in hours.
 * @param now - The current time.
 * @returns The due time.
 */
export const nextScanDue = (lastScanAt: Date | null, intervalHours: number, now: Date): Date =>
  lastScanAt === null ? now : new Date(lastScanAt.getTime() + intervalHours * MS_PER_HOUR);

/**
 * What {@link refreshRatesIfStale} did. `fresh`: the stored rates are recent enough, so nothing was fetched.
 * `unchanged`: the stored rates were stale but the fetch returned the date already stored or an older one, so
 * nothing was saved. `refreshed`: new rates were fetched and saved. `failed`: the fetch failed and the last stored
 * rates, if any, stay in use.
 */
export const RatesRefresh = {
  Fresh: "fresh",
  Unchanged: "unchanged",
  Refreshed: "refreshed",
  Failed: "failed",
} as const;

/** One of the {@link RatesRefresh} values. */
export type RatesRefresh = (typeof RatesRefresh)[keyof typeof RatesRefresh];

/** The ports that refreshing exchange rates uses. */
export interface RefreshRatesDeps {
  /** Holds the stored rates. */
  readonly repository: Repository;
  /** Where new rates come from. */
  readonly rates: CurrencyRates;
  /** Tells the current time. */
  readonly clock: Clock;
  /** Records a failed fetch. */
  readonly logger: Logger;
}

/**
 * Fetches and saves exchange rates unless the stored ones are fresh. Rates are stale when none are stored, when
 * their `fetchedOn` date cannot be read, or when more than a day has passed since the start (UTC) of that date.
 * A fetch that returns the date already stored, or an older one, is not saved, so a source that regresses
 * cannot overwrite newer rates. A failed fetch is logged, not thrown, so the scan still runs on the last
 * rates.
 *
 * @param deps - The ports to use.
 * @returns What happened.
 */
export const refreshRatesIfStale = async (deps: RefreshRatesDeps): Promise<RatesRefresh> => {
  const { repository, rates, clock, logger } = deps;
  const stored = await repository.fxRates.latest();
  if (stored !== null && clock.now().getTime() - Date.parse(stored.fetchedOn) <= FX_MAX_AGE_MS) {
    return RatesRefresh.Fresh;
  }
  const fetched = await rates.fetchLatest();
  if (!fetched.ok) {
    logger.warn("exchange rates could not be refreshed, using the last ones", { detail: fetched.error.detail });
    return RatesRefresh.Failed;
  }
  if (stored !== null && Date.parse(fetched.value.fetchedOn) <= Date.parse(stored.fetchedOn)) {
    return RatesRefresh.Unchanged;
  }
  await repository.fxRates.save(fetched.value);
  return RatesRefresh.Refreshed;
};
