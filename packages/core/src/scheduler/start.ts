import { err, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import { scanListings } from "../scan/scan.js";
import type { ScanDeps, ScanReport } from "../scan/scan.js";
import type { CurrencyRates } from "../ports/currency-rates.js";
import type { Scheduler } from "../ports/scheduler.js";
import { SchedulerErrorKind } from "./errors.js";
import { MS_PER_HOUR, nextScanDue, refreshRatesIfStale } from "./policy.js";

/** The ports the scheduler uses: those of a scan, plus the rates source and the timer. */
export interface SchedulerDeps extends ScanDeps {
  /** Where refreshed exchange rates come from. */
  readonly rates: CurrencyRates;
  /** Runs the repeating scan. */
  readonly scheduler: Scheduler;
}

/** A scan was asked for after the schedule was stopped. */
export interface SchedulerStopped {
  readonly kind: typeof SchedulerErrorKind.Stopped;
}

/** A running scan schedule. */
export interface SchedulerHandle {
  /**
   * Refreshes stale exchange rates, then scans. Scans never overlap: when one is already running, this joins it
   * and resolves to its report instead of starting another. Rejects when the scan throws. After {@link stop} it
   * starts nothing, not even when a scan is still finishing, and resolves to a `stopped` error.
   */
  scanNow(): Promise<Result<ScanReport, SchedulerStopped>>;
  /**
   * Cancels the schedule and resolves once a scan that was running has finished, so the host can then close the
   * database. It does not reject when that scan threw.
   */
  stop(): Promise<void>;
}

/**
 * Starts scanning on a schedule. A scan runs every `scanIntervalHours` while the app is up, and once on boot when
 * the last scan started at least one interval ago or never ran; after weeks offline that is still one scan. The
 * timer is anchored to the last scan, not to the boot: the first tick comes when that scan's interval is up, or one
 * interval after the boot scan, and a scan on demand pushes the next tick a full interval out. Each
 * scan refreshes stale exchange rates first. A scan that throws is logged and the schedule keeps ticking. The
 * interval is read from the settings here, so a change applies after a restart. The boot scan runs in the
 * background; `scanNow` joins it. A boot where every plugin is backing off still counts as a scan, because blocked
 * runs are recorded, so the next boot within the interval does not catch up.
 *
 * @param deps - The ports to use.
 * @returns A handle to scan on demand and to stop the schedule.
 */
export const startScheduler = async (deps: SchedulerDeps): Promise<SchedulerHandle> => {
  const { repository, clock, logger, scheduler } = deps;
  let running: Promise<ScanReport> | null = null;
  let stopped = false;
  const scanOnce = async (): Promise<Result<ScanReport, SchedulerStopped>> => {
    if (stopped) {
      return err({ kind: SchedulerErrorKind.Stopped });
    }
    running ??= (async () => {
      try {
        await refreshRatesIfStale(deps);
        return await scanListings(deps);
      } finally {
        running = null;
      }
    })();
    return ok(await running);
  };
  const scanInBackground = async (): Promise<void> => {
    try {
      await scanOnce();
    } catch (error) {
      logger.error("scheduled scan failed", {
        detail: error instanceof Error ? (error.stack ?? String(error)) : String(error),
      });
    }
  };
  const { scanIntervalHours } = await repository.settings.get();
  const intervalMs = scanIntervalHours * MS_PER_HOUR;
  const last = await repository.scanRuns.latest();
  const now = clock.now();
  const due = nextScanDue(last?.startedAt ?? null, scanIntervalHours, now);
  const overdue = due <= now;
  let cancel = scheduler.every(intervalMs, scanInBackground, overdue ? intervalMs : due.getTime() - now.getTime());
  const scanNow = async (): Promise<Result<ScanReport, SchedulerStopped>> => {
    if (!stopped) {
      cancel();
      cancel = scheduler.every(intervalMs, scanInBackground, intervalMs);
    }
    return scanOnce();
  };
  const stop = async (): Promise<void> => {
    stopped = true;
    cancel();
    await running?.catch(() => undefined);
  };
  if (overdue) {
    void scanInBackground();
  }
  return { scanNow, stop };
};
