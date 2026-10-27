import type { IdGenerator } from "../../src/index.ts";

/** An {@link IdGenerator} counting up from `id-1`. */
export const fakeIdGenerator = (): IdGenerator => {
  let count = 0;
  return {
    next: () => {
      count += 1;
      return `id-${String(count)}`;
    },
  };
};
