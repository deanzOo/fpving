import { setTimeout as delay } from "node:timers/promises";

/** The least time between two request starts to one host: two seconds, to stay polite to small shops. */
export const MIN_INTERVAL_MS = 2000;

/** The most random time added on top of {@link MIN_INTERVAL_MS}, so requests do not land on a fixed beat. */
export const MAX_JITTER_MS = 1000;

/** The clock, timer and randomness a {@link DomainLimiter} uses, injected so tests need no real waiting. */
export interface LimiterTiming {
  /** Milliseconds on a monotonic or wall clock; only differences matter. */
  now(): number;
  /** Resolves after the given number of milliseconds. */
  sleep(ms: number): Promise<void>;
  /** A fraction in `[0, 1)`. */
  random(): number;
}

/** The real clock, timer and random source. */
export const systemTiming: LimiterTiming = {
  now: () => Date.now(),
  sleep: (ms) => delay(ms),
  random: () => Math.random(),
};

/**
 * Spaces out requests per host. Requests to one host run one at a time, each starting at least
 * {@link MIN_INTERVAL_MS} plus up to {@link MAX_JITTER_MS} after the previous start; different hosts run in parallel.
 */
export interface DomainLimiter {
  /**
   * Runs `task` when the host of `url` is due.
   *
   * @param url - The request URL; its hostname is the key, whatever the port or scheme.
   * @param task - The request.
   * @returns What `task` returns; a rejection is passed on and does not block later requests.
   */
  run<T>(url: string, task: () => Promise<T>): Promise<T>;
}

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).hostname : url);

const settle = async (work: Promise<unknown>): Promise<void> => {
  await work.then(
    () => undefined,
    () => undefined,
  );
};

/**
 * Creates a limiter.
 *
 * @param timing - The clock, timer and random source, normally {@link systemTiming}.
 * @returns The limiter. Share one between the HTTP client and the browser so both count against the same hosts.
 */
export const createDomainLimiter = (timing: LimiterTiming): DomainLimiter => {
  const tails = new Map<string, Promise<void>>();
  const lastStarts = new Map<string, number>();

  const turn = async <T>(host: string, task: () => Promise<T>): Promise<T> => {
    const lastStart = lastStarts.get(host);
    if (lastStart !== undefined) {
      const interval = MIN_INTERVAL_MS + Math.floor(timing.random() * MAX_JITTER_MS);
      const wait = lastStart + interval - timing.now();
      if (wait > 0) {
        await timing.sleep(wait);
      }
    }
    lastStarts.set(host, timing.now());
    return task();
  };

  return {
    run: async (url, task) => {
      const host = hostOf(url);
      const result = (tails.get(host) ?? Promise.resolve()).then(() => turn(host, task));
      tails.set(host, settle(result));
      return result;
    },
  };
};
