import { productIdSchema } from "@fpving/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTimerScheduler,
  MAX_TIMER_DELAY_MS,
  systemClock,
  uuidIdGenerator,
} from "../../../src/adapters/system/system-ports.ts";

const INTERVAL_MS = 1000;
const FIRST_DELAY_MS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAMPLE = 100;
const TWICE = 2;
const THRICE = 3;
const TIMEOUT_RESOURCE = "Timeout";

describe("System clock", () => {
  it("tells the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("UUID id generator", () => {
  it("mints distinct random UUIDs that every id schema accepts", () => {
    const ids = Array.from({ length: SAMPLE }, () => uuidIdGenerator.next());
    expect(new Set(ids).size).toBe(SAMPLE);
    for (const id of ids) {
      expect(id).toMatch(UUID);
      expect(productIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

describe("Timer scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the task after the first delay, then once every interval", async () => {
    const task = vi.fn(async () => Promise.resolve());
    createTimerScheduler().every(INTERVAL_MS, task, FIRST_DELAY_MS);
    await vi.advanceTimersByTimeAsync(FIRST_DELAY_MS - 1);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(task).toHaveBeenCalledTimes(TWICE);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(task).toHaveBeenCalledTimes(THRICE);
  });

  it("never runs the task again once stopped, before or after its first run", async () => {
    const early = vi.fn(async () => Promise.resolve());
    const late = vi.fn(async () => Promise.resolve());
    const scheduler = createTimerScheduler();
    scheduler.every(INTERVAL_MS, early, FIRST_DELAY_MS)();
    const stopLate = scheduler.every(INTERVAL_MS, late, FIRST_DELAY_MS);
    await vi.advanceTimersByTimeAsync(FIRST_DELAY_MS);
    stopLate();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * SAMPLE);
    expect(early).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits out delays longer than one Node timer can hold instead of firing at once", async () => {
    const task = vi.fn(async () => Promise.resolve());
    const longDelay = MAX_TIMER_DELAY_MS * TWICE + FIRST_DELAY_MS;
    createTimerScheduler().every(longDelay, task, longDelay);
    await vi.advanceTimersByTimeAsync(longDelay - 1);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(longDelay);
    expect(task).toHaveBeenCalledTimes(TWICE);
  });

  it("does not keep the process alive on its own", () => {
    vi.useRealTimers();
    const timers = (): number => process.getActiveResourcesInfo().filter((name) => name === TIMEOUT_RESOURCE).length;
    const before = timers();
    const stop = createTimerScheduler().every(INTERVAL_MS, async () => Promise.resolve(), FIRST_DELAY_MS);
    expect(timers()).toBe(before);
    stop();
  });
});
