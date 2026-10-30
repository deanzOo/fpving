import { createServer } from "node:net";
import { ok } from "@fpving/core";
import type { CurrencyRates, FxTable, Notifier, Scheduler } from "@fpving/core";
import { vi } from "vitest";
import { z } from "zod";
import type { ClosableBrowserDriver } from "../../src/adapters/transport/playwright-browser-driver.ts";
import type { AppPorts } from "../../src/app/start.ts";
import type { SpawnWorker } from "../../src/plugins/runtime/connection.ts";
import { spawnSourceWorker } from "./plugin-workers.ts";

/** The exchange rates the fake source returns. */
export const FX: FxTable = { base: "EUR", fetchedOn: "2026-01-01", ratesPerBase: { USD: 1.1 } };

/** A port that was free a moment ago on 127.0.0.1. */
export const freePort = async (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = z.object({ port: z.number() }).parse(probe.address());
      probe.close(() => {
        resolve(port);
      });
    });
  });

/** Holds `port` on 127.0.0.1 until the returned function is awaited. */
export const occupy = async (port: number): Promise<() => Promise<void>> => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
  return async () => new Promise<void>((resolve) => {
    blocker.close(() => {
      resolve();
    });
  });
};

/** Fake ports for the app, recording what they were asked to do; plugins run on real source workers. */
export const fakePorts = () => {
  const order: string[] = [];
  const armed: number[] = [];
  const scheduler: Scheduler = {
    every: (intervalMs) => {
      armed.push(intervalMs);
      return () => {
        order.push("scheduler");
      };
    },
  };
  const browser: ClosableBrowserDriver = {
    fetchPage: async () => Promise.reject(new Error("no browser in tests")),
    close: async () => Promise.resolve(void order.push("browser")),
  };
  const fetchLatest = vi.fn<CurrencyRates["fetchLatest"]>(async () => Promise.resolve(ok(FX)));
  const rates: CurrencyRates = { fetchLatest };
  const notifier: Notifier = { notify: vi.fn(async () => Promise.resolve(ok(undefined))) };
  const spawned: string[] = [];
  const spawn: SpawnWorker = (data) => {
    spawned.push(JSON.stringify(data.entry));
    return spawnSourceWorker(data);
  };
  const ports: Partial<AppPorts> = { scheduler, browser, rates, notifier, spawn };
  return { order, ports, fetchLatest, armed, spawned };
};
