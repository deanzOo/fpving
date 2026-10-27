import { scanListings } from "../scan/scan.js";
import type { ScanDeps, ScanReport } from "../scan/scan.js";
import type { CurrencyRates } from "../ports/currency-rates.js";
import type { Scheduler } from "../ports/scheduler.js";
import { MS_PER_HOUR, nextScanDue, refreshRatesIfStale } from "./policy.js";

/** The ports the scheduler uses: those of a scan, plus the rates source and the timer. */
export interface SchedulerDeps extends ScanDeps {
  /** Where refreshed exchange rates come from. */
  readonly rates: CurrencyRates;
  /** Runs the repeating scan. */
  readonly scheduler: Scheduler;
}

/** A running scan schedule. */
export interface SchedulerHandle {
  /**
   * Refreshes stale exchange rates, then scans. Scans never overlap: when one is already running, this joins it
   * and resolves to its report instead of starting another. Rejects when the scan throws.
   */
  scanNow(): Promise<ScanReport>;
  /** Cancels the schedule. A scan already running finishes. */
  stop(): void;
}

/**
 * Starts scanning on a schedule. A scan runs every `scanIntervalHours` while the app is up, and once on boot when
 * the last scan started at least one interval ago or never ran; after weeks offline that is still one scan. Each
 * scan refreshes stale exchange rates first. A scan that throws is logged and the schedule keeps ticking. The
 * interval is read from the settings here, so a change applies after a restart. The boot scan runs in the
 * background; `scanNow` joins it.
 *
 * @param deps - The ports to use.
 * @returns A handle to scan on demand and to stop the schedule.
 */
export const startScheduler = async (deps: SchedulerDeps): Promise<SchedulerHandle> => {
  const { repository, clock, logger, scheduler } = deps;
  let running: Promise<ScanReport> | null = null;
  const scanNow = async (): Promise<ScanReport> => {
    running ??= (async () => {
      try {
        await refreshRatesIfStale(deps);
        return await scanListings(deps);
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const scanInBackground = async (): Promise<void> => {
    try {
      await scanNow();
    } catch (error) {
      logger.error("scheduled scan failed", { detail: String(error) });
    }
  };
  const { scanIntervalHours } = await repository.settings.get();
  const last = await repository.scanRuns.latest();
  const stop = scheduler.every(scanIntervalHours * MS_PER_HOUR, scanInBackground);
  if (nextScanDue(last?.startedAt ?? null, scanIntervalHours, clock.now()) <= clock.now()) {
    void scanInBackground();
  }
  return { scanNow, stop };
};
