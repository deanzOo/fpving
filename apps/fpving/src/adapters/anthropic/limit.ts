/** Runs a task once fewer than the limit are running, handing each freed slot to the longest-waiting task. */
export type Limit = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Creates a {@link Limit} that lets at most `max` tasks run at once.
 *
 * @param max - How many tasks may run at once.
 * @returns The limit.
 */
export const limitConcurrency = (max: number): Limit => {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running < max) {
      running += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) {
        running -= 1;
      } else {
        next();
      }
    }
  };
};
