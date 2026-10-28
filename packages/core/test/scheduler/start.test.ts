import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  err,
  listingIdSchema,
  ListingOrigin,
  ListingStatus,
  ok,
  PortErrorKind,
  pluginIdSchema,
  productIdSchema,
  ScanOutcome,
  scanRunIdSchema,
  SchedulerErrorKind,
  snapshotIdSchema,
  startScheduler,
} from "../../src/index.ts";
import type { CurrencyRates, FxTable, Listing, Repository, SchedulerDeps } from "../../src/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fetchedListing } from "../fakes/fetched-listing.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";
import { fakeLogger } from "../fakes/fake-logger.ts";
import { fakeNotifier } from "../fakes/fake-notifier.ts";
import { fakeScheduler } from "../fakes/fake-scheduler.ts";
import { fakeStoreGateway } from "../fakes/fake-store-gateway.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const INTERVAL_HOURS = 6;
const OFFLINE_DAYS = 21;
const TWICE = 2;
const PRICE = 10_000;
const SHOP = pluginIdSchema.parse("shop");
const P1 = productIdSchema.parse("p1");
const L1 = listingIdSchema.parse("l1");
const FRESH_RATES: FxTable = { base: "USD", ratesPerBase: {}, fetchedOn: "2026-10-27" };
const STALE_RATES: FxTable = { base: "USD", ratesPerBase: {}, fetchedOn: "2026-10-20" };

const drain = async (): Promise<void> => new Promise((resolve) => void setImmediate(resolve));

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

interface Options {
  readonly lastScanAgo?: number;
  readonly rates?: FxTable;
  readonly wrap?: (repository: Repository) => Repository;
  readonly onFetch?: (url: string) => Promise<void>;
}

const setup = async (options: Options = {}) => {
  const base = inMemoryRepository();
  await base.settings.save({ ...DEFAULT_SETTINGS, scanIntervalHours: INTERVAL_HOURS });
  await base.products.add(
    { id: P1, name: "Motor", createdAt: ago(DAY_MS), archivedAt: null, cheapestListingId: null },
    {
      id: L1,
      productId: P1,
      pluginId: SHOP,
      url: "https://shop.example/l1",
      title: "Motor",
      status: ListingStatus.Active,
      origin: ListingOrigin.Manual,
      addedAt: ago(DAY_MS),
      failureStreak: 0,
      notFoundStreak: 0,
    },
    {
      id: snapshotIdSchema.parse("s0"),
      listingId: L1,
      observedAt: ago(DAY_MS),
      shipTo: "IL",
      itemPrice: { amountMinor: PRICE, currency: "USD" },
      shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
      inStock: true,
    },
  );
  if (options.lastScanAgo !== undefined) {
    const startedAt = ago(options.lastScanAgo);
    await base.scanRuns.record({
      id: scanRunIdSchema.parse("old"),
      pluginId: SHOP,
      startedAt,
      finishedAt: startedAt,
      outcome: ScanOutcome.Ok,
      errorKind: null,
    });
  }
  await base.fxRates.save(options.rates ?? FRESH_RATES);
  const stores = fakeStoreGateway(
    [
      {
        id: SHOP,
        domains: ["shop.example"],
        listing: fetchedListing(PRICE),
      },
    ],
    options.onFetch,
  );
  const rateFetches: string[] = [];
  const rates: CurrencyRates = {
    fetchLatest: async () => {
      rateFetches.push("fetch");
      return Promise.resolve(ok(FRESH_RATES));
    },
  };
  const scheduler = fakeScheduler();
  const logger = fakeLogger();
  const deps: SchedulerDeps = {
    repository: options.wrap?.(base) ?? base,
    stores,
    ids: fakeIdGenerator(),
    clock: fakeClock(NOW),
    notifier: fakeNotifier(),
    logger,
    rates,
    scheduler,
  };
  return { deps, base, stores, scheduler, logger, rateFetches };
};

describe("The scan schedule", () => {
  it("schedules a scan every scanIntervalHours read from the settings at start", async () => {
    const { deps, scheduler } = await setup({ lastScanAgo: 0 });
    await startScheduler(deps);
    expect(scheduler.intervals).toEqual([INTERVAL_HOURS * HOUR_MS]);
  });

  it("waits for the first tick until the last scan's interval is up, then repeats every interval", async () => {
    const { deps, scheduler } = await setup({ lastScanAgo: HOUR_MS });
    await startScheduler(deps);
    expect(scheduler.firstDelays).toEqual([(INTERVAL_HOURS - 1) * HOUR_MS]);
    expect(scheduler.intervals).toEqual([INTERVAL_HOURS * HOUR_MS]);
  });

  it("waits a full interval for the first tick after a boot scan, overdue or first ever", async () => {
    const overdue = await setup({ lastScanAgo: OFFLINE_DAYS * DAY_MS });
    await startScheduler(overdue.deps);
    const never = await setup();
    await startScheduler(never.deps);
    expect([overdue.scheduler.firstDelays, never.scheduler.firstDelays]).toEqual([
      [INTERVAL_HOURS * HOUR_MS],
      [INTERVAL_HOURS * HOUR_MS],
    ]);
  });

  it("pushes the next tick a full interval out when a scan is run on demand", async () => {
    const { deps, scheduler } = await setup({ lastScanAgo: HOUR_MS });
    const handle = await startScheduler(deps);
    await handle.scanNow();
    expect(scheduler.firstDelays).toEqual([(INTERVAL_HOURS - 1) * HOUR_MS, INTERVAL_HOURS * HOUR_MS]);
    expect(scheduler.intervals).toEqual([INTERVAL_HOURS * HOUR_MS, INTERVAL_HOURS * HOUR_MS]);
  });

  it("keeps a single schedule after scans on demand and cancels it when stopped", async () => {
    const { deps, scheduler, stores } = await setup({ lastScanAgo: 0 });
    const handle = await startScheduler(deps);
    await handle.scanNow();
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(TWICE);
    await handle.stop();
    expect(scheduler.active()).toBe(false);
    await handle.scanNow();
    expect(scheduler.intervals).toHaveLength(TWICE);
  });

  it("scans once on boot when there was never a scan", async () => {
    const { deps, stores } = await setup();
    await startScheduler(deps);
    await drain();
    expect(stores.fetched).toHaveLength(1);
  });

  it("scans once on boot when the last scan is older than the interval", async () => {
    const { deps, stores } = await setup({ lastScanAgo: INTERVAL_HOURS * HOUR_MS });
    await startScheduler(deps);
    await drain();
    expect(stores.fetched).toHaveLength(1);
  });

  it("does not scan on boot when the last scan is within the interval", async () => {
    const { deps, stores } = await setup({ lastScanAgo: INTERVAL_HOURS * HOUR_MS - 1 });
    await startScheduler(deps);
    await drain();
    expect(stores.fetched).toHaveLength(0);
  });

  it("catches up with exactly one scan on boot after weeks offline, not one per missed interval", async () => {
    const { deps, stores, scheduler } = await setup({ lastScanAgo: OFFLINE_DAYS * DAY_MS });
    await startScheduler(deps);
    await drain();
    expect(stores.fetched).toHaveLength(1);
    await drain();
    expect(stores.fetched).toHaveLength(1);
    expect(scheduler.intervals).toHaveLength(1);
  });

  it("counts a boot scan of only backing-off plugins as a scan, so the next boot does not catch up", async () => {
    let recorded = 0;
    const countRuns = (repository: Repository): Repository => ({
      ...repository,
      scanRuns: {
        ...repository.scanRuns,
        record: async (run) => {
          recorded += 1;
          return repository.scanRuns.record(run);
        },
      },
    });
    const { deps, base, stores } = await setup({ wrap: countRuns });
    await base.pluginHealth.upsert({
      pluginId: SHOP,
      consecutiveBlocks: 1,
      backoffUntil: new Date(NOW.getTime() + HOUR_MS),
    });
    await startScheduler(deps);
    await drain();
    await startScheduler({ ...deps, scheduler: fakeScheduler() });
    await drain();
    expect(recorded).toBe(1);
    expect(stores.fetched).toHaveLength(0);
  });

  it("refreshes stale exchange rates before each scheduled scan", async () => {
    const { deps, scheduler, rateFetches, base } = await setup({ lastScanAgo: 0, rates: STALE_RATES });
    await startScheduler(deps);
    await scheduler.tick();
    expect(rateFetches).toEqual(["fetch"]);
    expect(await base.fxRates.latest()).toEqual(FRESH_RATES);
  });

  it("scans on every scheduled tick", async () => {
    const { deps, scheduler, stores } = await setup({ lastScanAgo: 0 });
    await startScheduler(deps);
    await scheduler.tick();
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(TWICE);
  });

  it("scans on stale rates when the rates fetch fails", async () => {
    const { deps, stores, logger } = await setup({ lastScanAgo: 0, rates: STALE_RATES });
    const rates: CurrencyRates = {
      fetchLatest: async () => Promise.resolve(err({ kind: PortErrorKind.RatesUnavailable, detail: "offline" })),
    };
    const handle = await startScheduler({ ...deps, rates });
    await handle.scanNow();
    expect(stores.fetched).toHaveLength(1);
    expect(logger.warnings).toHaveLength(1);
  });

  it("stops scheduling when stopped", async () => {
    const { deps, scheduler, stores } = await setup({ lastScanAgo: 0 });
    const handle = await startScheduler(deps);
    await handle.stop();
    await scheduler.tick();
    expect(scheduler.active()).toBe(false);
    expect(stores.fetched).toHaveLength(0);
  });

  it("starts no scan on scanNow after it was stopped and says it was stopped", async () => {
    const { deps, stores } = await setup({ lastScanAgo: 0 });
    const handle = await startScheduler(deps);
    await handle.stop();
    expect(await handle.scanNow()).toEqual(err({ kind: SchedulerErrorKind.Stopped }));
    expect(stores.fetched).toHaveLength(0);
  });

  it("scans immediately on scanNow and returns the report", async () => {
    const { deps, stores } = await setup({ lastScanAgo: 0 });
    const handle = await startScheduler(deps);
    const result = await handle.scanNow();
    expect(result.ok && result.value.plugins).toHaveLength(1);
    expect(stores.fetched).toHaveLength(1);
  });
});

describe("The scan schedule never overlapping scans", () => {
  const gated = async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const setupResult = await setup({ lastScanAgo: 0, onFetch: async () => gate });
    const handle = await startScheduler(setupResult.deps);
    return { ...setupResult, handle, open };
  };

  it("joins a scanNow made during a running scan to it instead of starting a second", async () => {
    const { handle, stores, open } = await gated();
    const first = handle.scanNow();
    const second = handle.scanNow();
    open();
    const [firstResult, secondResult] = [await first, await second];
    expect(firstResult.ok && secondResult.ok && secondResult.value === firstResult.value).toBe(true);
    expect(stores.fetched).toHaveLength(1);
  });

  it("joins a tick that fires during a running scan to it instead of starting a second", async () => {
    const { handle, scheduler, stores, open } = await gated();
    const running = handle.scanNow();
    const tick = scheduler.tick();
    open();
    await Promise.all([running, tick]);
    expect(stores.fetched).toHaveLength(1);
  });

  it("joins a scanNow made during the boot catch-up to it", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { deps, stores } = await setup({ onFetch: async () => gate });
    const handle = await startScheduler(deps);
    const joined = handle.scanNow();
    open();
    await joined;
    expect(stores.fetched).toHaveLength(1);
  });

  it("waits for a running scan to finish when stopped and starts no scan after it", async () => {
    const { handle, stores, scheduler, open } = await gated();
    const running = handle.scanNow();
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await drain();
    expect(stopped).toBe(false);
    expect((await handle.scanNow()).ok).toBe(false);
    open();
    await Promise.all([running, stopping]);
    expect(stopped).toBe(true);
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(1);
  });

  it("starts a new scan once the running one finished", async () => {
    const { handle, stores, scheduler, open } = await gated();
    const first = handle.scanNow();
    open();
    await first;
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(TWICE);
  });
});

describe("The scan schedule surviving a failing scan", () => {
  const failingOnce = (repository: Repository): Repository => {
    let failures = 1;
    return {
      ...repository,
      listings: {
        ...repository.listings,
        listToScan: async () => {
          if (failures > 0) {
            failures -= 1;
            return Promise.reject(new Error("database is locked"));
          }
          return repository.listings.listToScan();
        },
      },
    };
  };

  it("logs a scan that throws and keeps ticking", async () => {
    const { deps, scheduler, stores, logger } = await setup({ lastScanAgo: 0, wrap: failingOnce });
    await startScheduler(deps);
    await scheduler.tick();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]?.fields?.["detail"]).toMatch(/^Error: database is locked\n\s+at /u);
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(1);
  });

  it("logs a boot catch-up that throws and still schedules the ticks", async () => {
    const { deps, scheduler, stores, logger } = await setup({ wrap: failingOnce });
    await startScheduler(deps);
    await drain();
    expect(logger.errors).toHaveLength(1);
    await scheduler.tick();
    expect(stores.fetched).toHaveLength(1);
  });

  it.each<[string, () => unknown, string]>([
    ["an error without a stack", () => Object.assign(new Error("no stack"), { stack: undefined }), "Error: no stack"],
    ["something that is not an error", () => "plain text", "plain text"],
  ])("logs %s as its text", async (_, thrown, detail) => {
    const failing = (repository: Repository): Repository => ({
      ...repository,
      listings: { ...repository.listings, listToScan: vi.fn<() => Promise<Listing[]>>().mockRejectedValue(thrown()) },
    });
    const { deps, scheduler, logger } = await setup({ lastScanAgo: 0, wrap: failing });
    await startScheduler(deps);
    await scheduler.tick();
    expect(logger.errors).toEqual([{ message: "scheduled scan failed", fields: { detail } }]);
  });

  it("does not reject stop when the running scan throws", async () => {
    const { deps } = await setup({ wrap: failingOnce });
    const handle = await startScheduler(deps);
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it("rejects scanNow when the scan throws", async () => {
    const { deps } = await setup({ lastScanAgo: 0, wrap: failingOnce });
    const handle = await startScheduler(deps);
    await expect(handle.scanNow()).rejects.toThrow("database is locked");
  });
});
