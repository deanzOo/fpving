import type { Clock } from "../../src/index.ts";

/** A {@link Clock} that stands still until advanced. */
export const fakeClock = (start: Date): Clock & { advance(ms: number): void } => {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (ms) => {
      now += ms;
    },
  };
};
