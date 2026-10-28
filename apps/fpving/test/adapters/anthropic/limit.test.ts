import { describe, expect, it } from "vitest";
import { limitConcurrency } from "../../../src/adapters/anthropic/limit.ts";

const MAX = 2;
const TASKS = 5;

describe("Concurrency limit", () => {
  it("runs at most the limit of tasks at once and starts a queued task as each one finishes", async () => {
    const limit = limitConcurrency(MAX);
    const gates = Array.from({ length: TASKS }, () => Promise.withResolvers<undefined>());
    let running = 0;
    let peak = 0;
    const runs = gates.map(async (gate, index) => limit(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
      return index;
    }));
    await Promise.resolve();
    expect(running).toBe(MAX);
    for (const gate of gates) {
      gate.resolve(undefined);
      await Promise.resolve();
    }
    expect(await Promise.all(runs)).toEqual(gates.map((_, index) => index));
    expect(peak).toBe(MAX);
  });

  it("frees the slot of a task that rejects", async () => {
    const limit = limitConcurrency(1);
    const failed = limit(() => Promise.reject(new Error("boom")));
    await expect(failed).rejects.toThrow("boom");
    expect(await limit(() => Promise.resolve("next"))).toBe("next");
  });
});
