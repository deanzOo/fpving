import type { Scheduler } from "../../src/index.ts";

/**
 * A {@link Scheduler} with no timers: `tick` runs the scheduled task once, as if its timer had fired. It records the
 * interval and the first delay of every `every` call.
 */
export const fakeScheduler = (): Scheduler & {
  intervals: number[];
  firstDelays: number[];
  active(): boolean;
  tick(): Promise<void>;
} => {
  const intervals: number[] = [];
  const firstDelays: number[] = [];
  let task: (() => Promise<void>) | null = null;
  return {
    intervals,
    firstDelays,
    active: () => task !== null,
    every: (intervalMs, run, firstDelayMs) => {
      intervals.push(intervalMs);
      firstDelays.push(firstDelayMs);
      task = run;
      return () => {
        task = null;
      };
    },
    tick: async () => (task === null ? Promise.resolve() : task()),
  };
};
