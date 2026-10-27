import { describe, expect, it } from "vitest";
import {
  createDomainLimiter,
  MAX_JITTER_MS,
  MIN_INTERVAL_MS,
  systemTiming,
} from "../../../src/adapters/transport/domain-limiter.ts";

const START = 1_000_000;
const HALF = 0.5;
const NEARLY_ONE = 0.999;
const PART = 400;

const fakeTiming = (random = 0) => {
  let clock = START;
  const sleeps: number[] = [];
  return {
    timing: {
      now: () => clock,
      sleep: (ms: number) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      random: () => random,
    },
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

describe("Per-domain request limiting", () => {
  it("runs the first request to a host immediately", async () => {
    const { timing, sleeps } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    expect(await limiter.run("https://a.example/one", () => Promise.resolve("done"))).toBe("done");
    expect(sleeps).toEqual([]);
  });

  it("waits the minimum interval before a second request to the same host", async () => {
    const { timing, sleeps } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    await limiter.run("https://a.example/two", () => Promise.resolve());
    expect(sleeps).toEqual([MIN_INTERVAL_MS]);
  });

  it("adds random jitter below the maximum to the interval", async () => {
    const { timing, sleeps } = fakeTiming(HALF);
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    await limiter.run("https://a.example/two", () => Promise.resolve());
    expect(sleeps).toEqual([MIN_INTERVAL_MS + MAX_JITTER_MS * HALF]);
    const high = fakeTiming(NEARLY_ONE);
    const other = createDomainLimiter(high.timing);
    await other.run("https://a.example/one", () => Promise.resolve());
    await other.run("https://a.example/two", () => Promise.resolve());
    expect(high.sleeps[0]).toBeLessThan(MIN_INTERVAL_MS + MAX_JITTER_MS);
  });

  it("does not wait when enough time has already passed since the last start", async () => {
    const { timing, sleeps, advance } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    advance(MIN_INTERVAL_MS + 1);
    await limiter.run("https://a.example/two", () => Promise.resolve());
    expect(sleeps).toEqual([]);
  });

  it("waits only for the remainder of the interval", async () => {
    const { timing, sleeps, advance } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    advance(PART);
    await limiter.run("https://a.example/two", () => Promise.resolve());
    expect(sleeps).toEqual([MIN_INTERVAL_MS - PART]);
  });

  it("does not delay a different host", async () => {
    const { timing, sleeps } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    await limiter.run("https://b.example/one", () => Promise.resolve());
    expect(sleeps).toEqual([]);
  });

  it("treats the same hostname on another port or scheme as one host", async () => {
    const { timing, sleeps } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    await limiter.run("https://a.example/one", () => Promise.resolve());
    await limiter.run("http://a.example:8080/two", () => Promise.resolve());
    expect(sleeps).toEqual([MIN_INTERVAL_MS]);
  });

  it("serializes concurrent requests to one host in call order", async () => {
    const { timing } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`start ${name}`);
      await Promise.resolve();
      events.push(`end ${name}`);
    };
    await Promise.all([
      limiter.run("https://a.example/1", task("1")),
      limiter.run("https://a.example/2", task("2")),
      limiter.run("https://a.example/3", task("3")),
    ]);
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"]);
  });

  it("runs different hosts in parallel", async () => {
    const { timing } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = limiter.run("https://a.example/1", async () => {
      events.push("a start");
      await gate;
      events.push("a end");
    });
    await limiter.run("https://b.example/1", () => {
      events.push("b ran");
      return Promise.resolve();
    });
    release();
    await slow;
    expect(events).toEqual(["a start", "b ran", "a end"]);
  });

  it("keeps serving a host after one of its tasks rejects", async () => {
    const { timing } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    const failing = limiter.run("https://a.example/1", () => Promise.reject(new Error("boom")));
    const next = limiter.run("https://a.example/2", () => Promise.resolve("still served"));
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("still served");
  });

  it("keys a malformed url on its own text instead of throwing", async () => {
    const { timing } = fakeTiming();
    const limiter = createDomainLimiter(timing);
    expect(await limiter.run("not a url", () => Promise.resolve("ran"))).toBe("ran");
  });

  it("uses the system clock, a real timer and a random fraction by default", async () => {
    const before = Date.now();
    await systemTiming.sleep(0);
    expect(systemTiming.now()).toBeGreaterThanOrEqual(before);
    const fraction = systemTiming.random();
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThan(1);
  });
});
