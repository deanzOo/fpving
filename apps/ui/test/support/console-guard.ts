import { afterEach, beforeEach, expect, vi } from "vitest";

let logged: unknown[][] = [];

/**
 * Hands over what the current test logged to `console.error` and `console.warn` so far, so a test that expects a
 * logged error can assert it; whatever is left unclaimed fails the test.
 *
 * @returns The arguments of each call, in order.
 */
export const takeLogged = (): unknown[][] => {
  const taken = logged;
  logged = [];
  return taken;
};

beforeEach(() => {
  logged = [];
  for (const method of ["error", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(logged, "the test logged an error or warning it did not expect").toEqual([]);
});
