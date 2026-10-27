import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, StoreResult } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  AlertKind,
  alertIdSchema,
  DEFAULT_SETTINGS,
  err,
  ListingOrigin,
  ListingStatus,
  listingIdSchema,
  ok,
  pluginIdSchema,
  PortErrorKind,
  productIdSchema,
  RepositoryErrorKind,
  ScanOutcome,
  scanListings,
  scanRunIdSchema,
  snapshotIdSchema,
} from "../../src/index.ts";
import type {
  Listing,
  Notifier,
  PluginHealth,
  PriceSnapshot,
  Product,
  Repository,
  ScanDeps,
} from "../../src/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";
import { fakeLogger } from "../fakes/fake-logger.ts";
import { fakeNotifier } from "../fakes/fake-notifier.ts";
import { fakeStoreGateway } from "../fakes/fake-store-gateway.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PRICE = 10_000;
const LOWER = 9000;
const LOWEST = 8000;
const PLUGINS = 2;
const ILS_PER_USD = 3.6;
const BLOCK_MINUTES = { first: 15, third: 60, seventh: 960 };
const CAP_HOURS = 24;
const STREAK = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const AGE_DAYS = { two: 2, thirty: 30, thirtyOne: 31, old: 100 };

const SHOP = pluginIdSchema.parse("shop");
const OTHER = pluginIdSchema.parse("other");
const P1 = productIdSchema.parse("p1");

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const later = (ms: number): Date => new Date(NOW.getTime() + ms);

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id: productIdSchema.parse(id),
  name: `Product ${id}`,
  createdAt: daysAgo(AGE_DAYS.old),
  archivedAt: null,
  cheapestListingId: null,
  ...overrides,
});

const listing = (id: string, overrides: Partial<Listing> = {}): Listing => ({
  id: listingIdSchema.parse(id),
  productId: P1,
  pluginId: SHOP,
  url: `https://shop.example/${id}`,
  title: `Listing ${id}`,
  status: ListingStatus.Active,
  origin: ListingOrigin.Manual,
  addedAt: daysAgo(AGE_DAYS.old),
  failureStreak: 0,
  notFoundStreak: 0,
  ...overrides,
});

const snapshot = (row: Listing, amountMinor: number, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot => ({
  id: snapshotIdSchema.parse(`base-${row.id}`),
  listingId: row.id,
  observedAt: daysAgo(AGE_DAYS.two),
  shipTo: "IL",
  itemPrice: { amountMinor, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
  inStock: true,
  ...overrides,
});

const fetched = (amountMinor: number, inStock = true): StoreResult<FetchedListing> =>
  ok({
    title: "Fetched",
    itemPrice: { amountMinor, currency: "USD" },
    shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
    inStock,
    images: [],
  });

const TIMEOUT = err({ kind: StoreErrorKind.Timeout, detail: "slow" });
const NOT_FOUND = err({ kind: StoreErrorKind.NotFound, detail: "404" });
const BLOCKED = err({ kind: StoreErrorKind.Blocked, detail: "captcha" });

const l1 = listing("l1");
const l2 = listing("l2", { addedAt: daysAgo(AGE_DAYS.thirty) });
const l3 = listing("l3", { addedAt: daysAgo(AGE_DAYS.two) });
const o1 = listing("o1", { pluginId: OTHER, url: "https://other.example/o1" });

interface Options {
  readonly products?: Product[];
  readonly listings?: Listing[];
  readonly bases?: PriceSnapshot[];
  readonly answers?: [Listing, StoreResult<FetchedListing>][];
  readonly health?: PluginHealth[];
  readonly notifier?: Notifier;
  readonly rates?: boolean;
  readonly onFetch?: (url: string) => Promise<void>;
  readonly wrap?: (repository: Repository) => Repository;
}

const setup = async (options: Options = {}) => {
  const base = inMemoryRepository();
  const listings = options.listings ?? [l1];
  const bases = options.bases ?? [];
  const first = (row: Listing): PriceSnapshot => bases.find((s) => s.listingId === row.id) ?? snapshot(row, PRICE);
  for (const row of options.products ?? [product("p1")]) {
    const [head, ...rest] = listings.filter((l) => l.productId === row.id);
    if (head === undefined) {
      throw new Error(`no listing for ${row.id}`);
    }
    await base.products.add(row, head, first(head));
    for (const other of rest) {
      await base.listings.addWithSnapshot(other, first(other));
    }
  }
  for (const health of options.health ?? []) {
    await base.pluginHealth.upsert(health);
  }
  if (options.rates ?? true) {
    await base.fxRates.save({ base: "USD", ratesPerBase: { ILS: ILS_PER_USD }, fetchedOn: "2026-10-27" });
  }
  const byUrl = Object.fromEntries((options.answers ?? []).map(([row, answer]) => [row.url, answer]));
  const stores = fakeStoreGateway(
    [
      { id: SHOP, domains: ["shop.example"], listing: fetched(PRICE), byUrl },
      { id: OTHER, domains: ["other.example"], listing: fetched(PRICE), byUrl },
    ],
    options.onFetch,
  );
  const repository = options.wrap?.(base) ?? base;
  const clock = fakeClock(NOW);
  const notifier = fakeNotifier();
  const logger = fakeLogger();
  const deps: ScanDeps = {
    repository,
    stores,
    ids: fakeIdGenerator(),
    clock,
    notifier: options.notifier ?? notifier,
    logger,
  };
  return { deps, repository: base, stores, clock, notifier, logger };
};

const state = (status: ListingStatus, failureStreak: number, notFoundStreak: number) => ({
  status,
  failureStreak,
  notFoundStreak,
});

const statusOf = async (repository: Repository, row: Listing) => {
  const found = await repository.listings.findByUrl(row.url);
  return found && state(found.status, found.failureStreak, found.notFoundStreak);
};

describe("Scanning listings", () => {
  describe("Fetching", () => {
    it("appends a snapshot of each fetched listing, quoted for the saved ship-to country", async () => {
      const { deps, repository } = await setup({ answers: [[l1, fetched(LOWER, false)]] });
      await repository.settings.save({ ...DEFAULT_SETTINGS, shipToCountry: "US" });
      await scanListings(deps);
      expect(await repository.snapshots.listSince(l1.id, NOW)).toEqual([
        {
          ...snapshot(l1, LOWER, { inStock: false, shipTo: "US" }),
          id: snapshotIdSchema.parse("id-1"),
          observedAt: NOW,
        },
      ]);
    });

    it("fetches active and stale listings and skips gone ones and those of archived products", async () => {
      const stale = { ...l2, status: ListingStatus.Stale };
      const gone = { ...l3, status: ListingStatus.Gone };
      const archived = listing("a1", { productId: productIdSchema.parse("p2") });
      const { deps, stores } = await setup({
        products: [product("p1"), product("p2", { archivedAt: daysAgo(1) })],
        listings: [l1, stale, gone, archived],
      });
      await scanListings(deps);
      expect(stores.fetched).toEqual([l1.url, stale.url]);
    });

    it("runs plugins in parallel and each plugin's listings one at a time", async () => {
      const events: string[] = [];
      const onFetch = async (url: string): Promise<void> => {
        events.push(`start ${url}`);
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        events.push(`end ${url}`);
      };
      const { deps } = await setup({ listings: [l1, l2, o1], onFetch });
      await scanListings(deps);
      expect(events.slice(0, PLUGINS).toSorted()).toEqual([`start ${o1.url}`, `start ${l1.url}`].toSorted());
      expect(events.indexOf(`end ${l1.url}`)).toBeLessThan(events.indexOf(`start ${l2.url}`));
    });
  });

  describe("Listing health", () => {
    it("counts a failed fetch in the listing's failure streak and stores no snapshot", async () => {
      const { deps, repository } = await setup({ answers: [[l1, TIMEOUT]] });
      await scanListings(deps);
      expect(await statusOf(repository, l1)).toEqual(state(ListingStatus.Active, 1, 0));
      expect(await repository.snapshots.listSince(l1.id, NOW)).toEqual([]);
    });

    it("keeps a listing active after two consecutive failures and marks it stale on the third", async () => {
      const once = { ...l1, failureStreak: STREAK.one };
      const twice = { ...l2, failureStreak: STREAK.two };
      const answers: Options["answers"] = [[once, TIMEOUT], [twice, TIMEOUT]];
      const { deps, repository } = await setup({ listings: [once, twice], answers });
      await scanListings(deps);
      expect(await statusOf(repository, once)).toEqual(state(ListingStatus.Active, STREAK.two, 0));
      expect(await statusOf(repository, twice)).toEqual(state(ListingStatus.Stale, STREAK.three, 0));
    });

    it("keeps a stale listing stale while it keeps failing", async () => {
      const stale = { ...l1, status: ListingStatus.Stale, failureStreak: STREAK.five };
      const { deps, repository } = await setup({ listings: [stale], answers: [[stale, TIMEOUT]] });
      const report = await scanListings(deps);
      expect(await statusOf(repository, stale)).toEqual(state(ListingStatus.Stale, STREAK.six, 0));
      expect(report.transitions).toEqual([]);
    });

    it("returns a stale listing to active and resets both streaks on a successful fetch", async () => {
      const stale = { ...l1, status: ListingStatus.Stale, failureStreak: STREAK.four, notFoundStreak: 1 };
      const { deps, repository } = await setup({ listings: [stale] });
      await scanListings(deps);
      expect(await statusOf(repository, stale)).toEqual(state(ListingStatus.Active, 0, 0));
    });

    it("keeps a listing active after its first not_found and marks it gone on the second in a row", async () => {
      const once = { ...l2, notFoundStreak: 1, failureStreak: 1 };
      const { deps, repository } = await setup({ listings: [l1, once], answers: [[l1, NOT_FOUND], [once, NOT_FOUND]] });
      await scanListings(deps);
      expect(await statusOf(repository, l1)).toEqual(state(ListingStatus.Active, 1, 1));
      expect(await statusOf(repository, once)).toEqual(state(ListingStatus.Gone, STREAK.two, STREAK.two));
    });

    it("restarts the not_found count when a different failure comes between", async () => {
      const once = { ...l1, notFoundStreak: 1, failureStreak: 1 };
      const { deps, repository } = await setup({ listings: [once], answers: [[once, TIMEOUT]] });
      await scanListings(deps);
      expect(await statusOf(repository, once)).toEqual(state(ListingStatus.Active, STREAK.two, 0));
    });

    it("never fetches a listing again once it is gone", async () => {
      const once = { ...l1, notFoundStreak: 1 };
      const { deps, stores } = await setup({ listings: [once], answers: [[once, NOT_FOUND]] });
      await scanListings(deps);
      await scanListings(deps);
      expect(stores.fetched).toEqual([once.url]);
    });

    it("reports each listing whose status changed", async () => {
      const failing = { ...l2, failureStreak: STREAK.two };
      const stale = { ...l3, status: ListingStatus.Stale, failureStreak: STREAK.three };
      const { deps } = await setup({ listings: [l1, failing, stale], answers: [[failing, TIMEOUT]] });
      const report = await scanListings(deps);
      expect(report.transitions).toEqual([
        { listingId: failing.id, from: ListingStatus.Active, to: ListingStatus.Stale },
        { listingId: stale.id, from: ListingStatus.Stale, to: ListingStatus.Active },
      ]);
    });

    it("skips a listing removed while the scan runs: no status change and no alert", async () => {
      const failing = { ...l2, failureStreak: STREAK.two };
      const wrap = (repository: Repository): Repository => ({
        ...repository,
        snapshots: {
          ...repository.snapshots,
          append: async (row) =>
            row.listingId === l1.id
              ? Promise.resolve(err({ kind: RepositoryErrorKind.NotFound }))
              : repository.snapshots.append(row),
        },
        listings: {
          ...repository.listings,
          updateStatus: async () => Promise.resolve(err({ kind: RepositoryErrorKind.NotFound })),
        },
      });
      const { deps } = await setup({
        listings: [l1, failing, l3],
        answers: [[l1, fetched(LOWER)], [failing, TIMEOUT], [l3, fetched(LOWER)]],
        wrap,
      });
      const report = await scanListings(deps);
      expect(report.transitions).toEqual([]);
      expect(report.alerts).toEqual([]);
    });
  });

  describe("Plugin backoff", () => {
    it("backs a plugin off for 15 minutes on its first block and stops fetching its other listings", async () => {
      const { deps, repository, stores } = await setup({ listings: [l1, l2], answers: [[l1, BLOCKED]] });
      await scanListings(deps);
      expect(stores.fetched).toEqual([l1.url]);
      expect(await repository.pluginHealth.get(SHOP)).toEqual({
        pluginId: SHOP,
        consecutiveBlocks: 1,
        backoffUntil: later(BLOCK_MINUTES.first * MINUTE_MS),
      });
      expect(await statusOf(repository, l1)).toEqual(state(ListingStatus.Active, 1, 0));
      expect(await repository.snapshots.listSince(l2.id, NOW)).toEqual([]);
    });

    it("doubles the backoff with each consecutive block", async () => {
      const health = { pluginId: SHOP, consecutiveBlocks: STREAK.two, backoffUntil: later(-MINUTE_MS) };
      const { deps, repository } = await setup({ health: [health], answers: [[l1, BLOCKED]] });
      await scanListings(deps);
      expect(await repository.pluginHealth.get(SHOP)).toEqual({
        pluginId: SHOP,
        consecutiveBlocks: STREAK.three,
        backoffUntil: later(BLOCK_MINUTES.third * MINUTE_MS),
      });
    });

    it("caps the backoff at 24 hours", async () => {
      const health = [
        { pluginId: SHOP, consecutiveBlocks: STREAK.six, backoffUntil: null },
        { pluginId: OTHER, consecutiveBlocks: STREAK.seven, backoffUntil: null },
      ];
      const { deps, repository } = await setup({ listings: [l1, o1], health, answers: [[l1, BLOCKED], [o1, BLOCKED]] });
      await scanListings(deps);
      expect((await repository.pluginHealth.get(SHOP)).backoffUntil).toEqual(later(BLOCK_MINUTES.seventh * MINUTE_MS));
      expect((await repository.pluginHealth.get(OTHER)).backoffUntil).toEqual(later(CAP_HOURS * HOUR_MS));
    });

    it("skips a plugin whose backoff has not expired, fetching nothing and recording a blocked run", async () => {
      const health = { pluginId: SHOP, consecutiveBlocks: 1, backoffUntil: later(1) };
      const { deps, repository, stores } = await setup({ health: [health] });
      const report = await scanListings(deps);
      expect(stores.fetched).toEqual([]);
      const run = {
        id: scanRunIdSchema.parse("id-1"),
        pluginId: SHOP,
        startedAt: NOW,
        finishedAt: NOW,
        outcome: ScanOutcome.Blocked,
        errorKind: StoreErrorKind.Blocked,
      };
      expect(await repository.scanRuns.latest(SHOP)).toEqual(run);
      expect(report.plugins).toEqual([{ run, succeeded: 0, failed: 0 }]);
      expect(await repository.pluginHealth.get(SHOP)).toEqual(health);
    });

    it("scans a plugin again from the instant its backoff ends", async () => {
      const health = { pluginId: SHOP, consecutiveBlocks: 1, backoffUntil: NOW };
      const { deps, stores } = await setup({ health: [health] });
      await scanListings(deps);
      expect(stores.fetched).toEqual([l1.url]);
    });

    it("clears the block count and the backoff after any successful fetch", async () => {
      const health = { pluginId: SHOP, consecutiveBlocks: STREAK.three, backoffUntil: later(-MINUTE_MS) };
      const { deps, repository } = await setup({ health: [health] });
      await scanListings(deps);
      const cleared = { pluginId: SHOP, consecutiveBlocks: 0, backoffUntil: null };
      expect(await repository.pluginHealth.get(SHOP)).toEqual(cleared);
    });

    it("leaves the backoff alone on failures other than blocked", async () => {
      const health = { pluginId: SHOP, consecutiveBlocks: STREAK.two, backoffUntil: later(-MINUTE_MS) };
      const { deps, repository } = await setup({ health: [health], answers: [[l1, NOT_FOUND]] });
      await scanListings(deps);
      expect(await repository.pluginHealth.get(SHOP)).toEqual(health);
    });
  });

  describe("Scan runs", () => {
    it("records one run per plugin, started and finished at the clock's times", async () => {
      const { deps, repository, clock } = await setup({
        onFetch: async () => {
          clock.advance(MINUTE_MS);
          return Promise.resolve();
        },
      });
      const report = await scanListings(deps);
      const run = {
        id: scanRunIdSchema.parse("id-2"),
        pluginId: SHOP,
        startedAt: NOW,
        finishedAt: later(MINUTE_MS),
        outcome: ScanOutcome.Ok,
        errorKind: null,
      };
      expect(await repository.scanRuns.latest()).toEqual(run);
      expect(report.plugins).toEqual([{ run, succeeded: 1, failed: 0 }]);
    });

    it("ends ok when any listing succeeded, even if others failed", async () => {
      const { deps } = await setup({ listings: [l1, l2], answers: [[l2, TIMEOUT]] });
      const [scan] = (await scanListings(deps)).plugins;
      expect(scan).toMatchObject({ run: { outcome: ScanOutcome.Ok, errorKind: null }, succeeded: 1, failed: 1 });
    });

    it("ends failed with the last store error when every fetch failed", async () => {
      const { deps } = await setup({ listings: [l1, l2], answers: [[l1, TIMEOUT], [l2, NOT_FOUND]] });
      const [scan] = (await scanListings(deps)).plugins;
      expect(scan).toMatchObject({
        run: { outcome: ScanOutcome.Failed, errorKind: StoreErrorKind.NotFound },
        succeeded: 0,
        failed: STREAK.two,
      });
    });

    it("ends blocked when a fetch was blocked, even after a success", async () => {
      const { deps } = await setup({ listings: [l1, l2], answers: [[l2, BLOCKED]] });
      const [scan] = (await scanListings(deps)).plugins;
      expect(scan).toMatchObject({
        run: { outcome: ScanOutcome.Blocked, errorKind: StoreErrorKind.Blocked },
        succeeded: 1,
        failed: 1,
      });
    });
  });

  describe("Alerts", () => {
    it("stores a price drop alert under a generated id before notifying it", async () => {
      const storedWhenNotified: unknown[] = [];
      const { deps, repository } = await setup({ answers: [[l1, fetched(LOWER)]] });
      const sent = fakeNotifier();
      const notifier: Notifier = {
        notify: async (notification) => {
          storedWhenNotified.push(...(await repository.alerts.list({ unreadOnly: false })));
          return sent.notify(notification);
        },
      };
      const report = await scanListings({ ...deps, notifier });
      const alert = {
        id: alertIdSchema.parse("id-3"),
        productId: P1,
        listingId: l1.id,
        kind: AlertKind.PriceDrop,
        beforeSnapshotId: snapshotIdSchema.parse("base-l1"),
        afterSnapshotId: snapshotIdSchema.parse("id-1"),
        createdAt: NOW,
        readAt: null,
      };
      expect(report.alerts).toEqual([alert]);
      expect(storedWhenNotified).toEqual([alert]);
      expect(sent.sent).toEqual([
        { alertId: alert.id, title: "Product p1", body: "Its price dropped to a new 30-day low." },
      ]);
    });

    it("keeps the alert stored, logs the failure and finishes the scan when the notifier fails", async () => {
      const notifier = fakeNotifier(err({ kind: PortErrorKind.NotifyFailed, detail: "denied" }));
      const { deps, repository, logger } = await setup({ answers: [[l1, fetched(LOWER)]], notifier });
      const report = await scanListings(deps);
      expect(await repository.alerts.list({ unreadOnly: false })).toEqual(report.alerts);
      expect(report.alerts).toHaveLength(1);
      expect(logger.warnings).toEqual([
        { message: "alert notification failed", fields: { alertId: "id-3", detail: "denied" } },
      ]);
    });

    it("evaluates a listing against its snapshots of the last 30 days only", async () => {
      const bases = [
        snapshot(l1, PRICE, { inStock: false, observedAt: daysAgo(AGE_DAYS.thirtyOne) }),
        snapshot(l2, PRICE, { inStock: false, observedAt: daysAgo(AGE_DAYS.thirty) }),
      ];
      const { deps } = await setup({ listings: [l1, l2], bases });
      const report = await scanListings(deps);
      expect(report.alerts.map(({ kind, listingId }) => ({ kind, listingId }))).toEqual([
        { kind: AlertKind.BackInStock, listingId: l2.id },
      ]);
    });

    it("raises one new cheapest alert when several listings of a product get cheaper in one scan", async () => {
      const { deps, repository } = await setup({
        products: [product("p1", { cheapestListingId: l1.id })],
        listings: [l1, l2, l3],
        bases: [snapshot(l2, LOWER, { inStock: false }), snapshot(l3, LOWER, { inStock: false })],
        answers: [[l2, fetched(LOWEST)], [l3, fetched(LOWER)]],
      });
      const report = await scanListings(deps);
      const cheapest = report.alerts.filter((row) => row.kind === AlertKind.NewCheapest);
      expect(cheapest.map((row) => row.listingId)).toEqual([l2.id]);
      expect((await repository.products.get(P1))?.cheapestListingId).toBe(l2.id);
    });

    it("stores the product's cheapest listing only when it changed", async () => {
      const calls: unknown[] = [];
      const wrap = (repository: Repository): Repository => ({
        ...repository,
        products: {
          ...repository.products,
          setCheapest: async (id, listingId) => {
            calls.push([id, listingId]);
            return repository.products.setCheapest(id, listingId);
          },
        },
      });
      const { deps, repository } = await setup({ wrap });
      await scanListings(deps);
      await scanListings(deps);
      expect(calls).toEqual([[P1, l1.id]]);
      expect((await repository.products.get(P1))?.cheapestListingId).toBe(l1.id);
    });

    it("still raises price drops but compares no stores when no exchange rates were ever fetched", async () => {
      const { deps, repository } = await setup({
        products: [product("p1", { cheapestListingId: l1.id })],
        listings: [l1, l2],
        answers: [[l2, fetched(LOWER)]],
        rates: false,
      });
      const report = await scanListings(deps);
      expect(report.alerts.map((row) => row.kind)).toEqual([AlertKind.PriceDrop]);
      expect((await repository.products.get(P1))?.cheapestListingId).toBe(l1.id);
    });

    it("rejects as a bug when the product of a scanned listing is missing", async () => {
      const wrap = (repository: Repository): Repository => ({
        ...repository,
        products: { ...repository.products, get: async () => Promise.resolve(null) },
      });
      const { deps } = await setup({ wrap });
      await expect(scanListings(deps)).rejects.toThrow();
    });
  });
});
