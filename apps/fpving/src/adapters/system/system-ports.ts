import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator, Scheduler } from "@fpving/core";

/** The longest delay one Node timer holds; a longer one fires at once. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The core `Clock` on the system time. */
export const systemClock: Clock = { now: () => new Date() };

/** The core `IdGenerator` minting random version 4 UUIDs. */
export const uuidIdGenerator: IdGenerator = { next: () => randomUUID() };

/**
 * Creates the core `Scheduler` on Node timers. Its timers are unref'd, so a schedule never keeps the process alive
 * on its own, and a delay longer than {@link MAX_TIMER_DELAY_MS} is waited out in several timers. The next run is
 * armed when a run starts, so the interval is measured between starts.
 *
 * @returns The scheduler.
 */
export const createTimerScheduler = (): Scheduler => ({
  every: (intervalMs, task, firstDelayMs) => {
    let timer: NodeJS.Timeout | undefined;
    const arm = (delayMs: number): void => {
      const wait = Math.min(delayMs, MAX_TIMER_DELAY_MS);
      timer = setTimeout(() => {
        if (delayMs > wait) {
          arm(delayMs - wait);
          return;
        }
        arm(intervalMs);
        void task();
      }, wait).unref();
    };
    arm(firstDelayMs);
    return () => {
      clearTimeout(timer);
    };
  },
});
