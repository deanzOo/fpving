import type { Scheduler } from "../../src/index.ts";

/**
 * A {@link Scheduler} with no timers: `tick` runs every scheduled task that was not cancelled once, as if its timer
 * had fired, and `live` counts them. It records the interval and the first delay of every `every` call.
 */
export const fakeScheduler = (): Scheduler & {
  intervals: number[];
  firstDelays: number[];
  active(): boolean;
  live(): number;
  tick(): Promise<void>;
} => {
  const intervals: number[] = [];
  const firstDelays: number[] = [];
  const tasks = new Set<() => Promise<void>>();
  return {
    intervals,
    firstDelays,
    active: () => tasks.size > 0,
    live: () => tasks.size,
    every: (intervalMs, run, firstDelayMs) => {
      intervals.push(intervalMs);
      firstDelays.push(firstDelayMs);
      const task = async (): Promise<void> => run();
      tasks.add(task);
      return () => {
        tasks.delete(task);
      };
    },
    tick: async () => {
      for (const task of [...tasks]) {
        await task();
      }
    },
  };
};
