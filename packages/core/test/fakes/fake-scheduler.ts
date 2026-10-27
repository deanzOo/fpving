import type { Scheduler } from "../../src/index.ts";

/** A {@link Scheduler} with no timers: `tick` runs the scheduled task once, as if one interval had passed. */
export const fakeScheduler = (): Scheduler & {
  intervals: number[];
  active(): boolean;
  tick(): Promise<void>;
} => {
  const intervals: number[] = [];
  let task: (() => Promise<void>) | null = null;
  return {
    intervals,
    active: () => task !== null,
    every: (intervalMs, run) => {
      intervals.push(intervalMs);
      task = run;
      return () => {
        task = null;
      };
    },
    tick: async () => (task === null ? Promise.resolve() : task()),
  };
};
