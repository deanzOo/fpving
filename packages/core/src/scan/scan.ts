import { StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, Logger, StoreResult } from "@fpving/plugin-sdk";
import { evaluate } from "../alerts/evaluate.js";
import { PRICE_DROP_WINDOW_MS } from "../alerts/price-drop.js";
import { AlertKind, ListingStatus, ScanOutcome } from "../entities.js";
import type { Alert, Listing, PriceSnapshot, ScanRun, Settings } from "../entities.js";
import { alertIdSchema, scanRunIdSchema, snapshotIdSchema } from "../ids.js";
import type { ListingId, PluginId, ProductId } from "../ids.js";
import type { Notifier } from "../ports/notifier.js";
import type { ListingStatusUpdate } from "../ports/repository.js";
import type { FxTable } from "../pricing/fx.js";
import type { AddDeps } from "../products/add.js";

const STALE_AFTER_FAILURES = 3;
const GONE_AFTER_NOT_FOUND = 2;
const BACKOFF_BASE_MINUTES = 15;
const BACKOFF_CAP_HOURS = 24;
const BACKOFF_GROWTH = 2;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

const MESSAGES: Readonly<Record<AlertKind, string>> = {
  [AlertKind.PriceDrop]: "Its price dropped to a new 30-day low.",
  [AlertKind.BackInStock]: "It is back in stock.",
  [AlertKind.NewCheapest]: "Another listing is now the cheapest.",
};

/** The ports a scan uses: those of adding a product, plus the notifier for alerts and the logger. */
export interface ScanDeps extends AddDeps {
  /** Shows each raised alert. */
  readonly notifier: Notifier;
  /** Records alerts that could not be shown. */
  readonly logger: Logger;
}

/** A listing whose status a scan changed. */
export interface ListingTransition {
  readonly listingId: ListingId;
  readonly from: ListingStatus;
  readonly to: ListingStatus;
}

/** One plugin's part of a scan: its recorded run and how many of its fetches succeeded and failed. */
export interface PluginScan {
  readonly run: ScanRun;
  readonly succeeded: number;
  readonly failed: number;
}

/** What {@link scanListings} did. */
export interface ScanReport {
  /** One entry per plugin that has listings to scan, in plugin id order. */
  readonly plugins: PluginScan[];
  /** The alerts raised and stored, whether or not the notifier could show them. */
  readonly alerts: Alert[];
  /** The listings whose status changed. */
  readonly transitions: ListingTransition[];
}

interface Fetched {
  readonly listing: Listing;
  readonly snapshot: PriceSnapshot;
}

interface PluginResult extends PluginScan {
  readonly fetched: Fetched[];
  readonly transitions: ListingTransition[];
}

const statusAfter = (listing: Listing, result: StoreResult<FetchedListing>): ListingStatusUpdate => {
  if (result.ok) {
    return { status: ListingStatus.Active, failureStreak: 0, notFoundStreak: 0 };
  }
  const failureStreak = listing.failureStreak + 1;
  const notFoundStreak = result.error.kind === StoreErrorKind.NotFound ? listing.notFoundStreak + 1 : 0;
  if (notFoundStreak >= GONE_AFTER_NOT_FOUND) {
    return { status: ListingStatus.Gone, failureStreak, notFoundStreak };
  }
  const status = failureStreak >= STALE_AFTER_FAILURES ? ListingStatus.Stale : listing.status;
  return { status, failureStreak, notFoundStreak };
};

const backoffEnd = (now: Date, consecutiveBlocks: number): Date => {
  const minutes = Math.min(
    BACKOFF_BASE_MINUTES * BACKOFF_GROWTH ** (consecutiveBlocks - 1),
    BACKOFF_CAP_HOURS * MINUTES_PER_HOUR,
  );
  return new Date(now.getTime() + minutes * MS_PER_MINUTE);
};

const outcomeOf = (errorKind: StoreErrorKind | null, succeeded: number): ScanOutcome => {
  if (errorKind === StoreErrorKind.Blocked) {
    return ScanOutcome.Blocked;
  }
  return succeeded > 0 ? ScanOutcome.Ok : ScanOutcome.Failed;
};

const newSnapshot = (deps: ScanDeps, settings: Settings, listing: Listing, fetched: FetchedListing): PriceSnapshot => {
  const { itemPrice, shipping, inStock } = fetched;
  return {
    id: snapshotIdSchema.parse(deps.ids.next()),
    listingId: listing.id,
    observedAt: deps.clock.now(),
    shipTo: settings.shipToCountry,
    itemPrice,
    shipping,
    inStock,
  };
};

const scanPlugin = async (
  deps: ScanDeps,
  settings: Settings,
  pluginId: PluginId,
  listings: readonly Listing[],
): Promise<PluginResult> => {
  const { repository, clock } = deps;
  const startedAt = clock.now();
  const health = await repository.pluginHealth.get(pluginId);
  const backingOff = health.backoffUntil !== null && health.backoffUntil > startedAt;
  const fetched: Fetched[] = [];
  const transitions: ListingTransition[] = [];
  let { consecutiveBlocks, backoffUntil } = health;
  let errorKind: StoreErrorKind | null = backingOff ? StoreErrorKind.Blocked : null;
  let succeeded = 0;
  let failed = 0;
  for (const listing of backingOff ? [] : listings) {
    const result = await deps.stores.fetchListing(pluginId, listing.url);
    const update = statusAfter(listing, result);
    const snapshot = result.ok ? newSnapshot(deps, settings, listing, result.value) : null;
    const blocked = !result.ok && result.error.kind === StoreErrorKind.Blocked;
    if (result.ok) {
      succeeded += 1;
      consecutiveBlocks = 0;
      backoffUntil = null;
    } else {
      failed += 1;
      errorKind = result.error.kind;
    }
    if (blocked) {
      consecutiveBlocks += 1;
      backoffUntil = backoffEnd(clock.now(), consecutiveBlocks);
    }
    const stored = snapshot === null || (await repository.snapshots.append(snapshot)).ok;
    const updated = stored && (await repository.listings.updateStatus(listing.id, update)).ok;
    if (updated && update.status !== listing.status) {
      transitions.push({ listingId: listing.id, from: listing.status, to: update.status });
    }
    if (updated && snapshot !== null) {
      fetched.push({ listing: { ...listing, ...update }, snapshot });
    }
    if (blocked) {
      break;
    }
  }
  if (!backingOff) {
    await repository.pluginHealth.upsert({ pluginId, consecutiveBlocks, backoffUntil });
  }
  const outcome = outcomeOf(errorKind, succeeded);
  const run: ScanRun = {
    id: scanRunIdSchema.parse(deps.ids.next()),
    pluginId,
    startedAt,
    finishedAt: clock.now(),
    outcome,
    errorKind: outcome === ScanOutcome.Ok ? null : errorKind,
  };
  await repository.scanRuns.record(run);
  return { run, succeeded, failed, fetched, transitions };
};

const evaluateProduct = async (
  deps: ScanDeps,
  settings: Settings,
  rates: FxTable | null,
  productId: ProductId,
  rows: readonly Fetched[],
): Promise<Alert[]> => {
  const { repository, clock, ids, notifier, logger } = deps;
  const product = await repository.products.get(productId);
  if (product === null) {
    throw new Error(`the scanned product ${productId} is missing`);
  }
  const listings = await repository.listings.listByProduct(productId);
  const latest = await repository.snapshots.latestPerListing(productId);
  const productListings = listings.flatMap((listing) =>
    latest.filter((row) => row.listingId === listing.id).map((row) => ({ listing, latest: row })),
  );
  const alerts: Alert[] = [];
  let previousCheapestListingId = product.cheapestListingId;
  for (const { listing, snapshot } of rows) {
    const now = clock.now();
    const history = await repository.snapshots.listSince(listing.id, new Date(now.getTime() - PRICE_DROP_WINDOW_MS));
    const evaluation = evaluate({
      listing,
      history,
      incoming: snapshot,
      productListings,
      previousCheapestListingId,
      rates,
      settings,
      now,
    });
    previousCheapestListingId = evaluation.cheapestListingId;
    for (const draft of evaluation.alerts) {
      const alert: Alert = { ...draft, id: alertIdSchema.parse(ids.next()), readAt: null };
      await repository.alerts.save(alert);
      alerts.push(alert);
      const shown = await notifier.notify({ alertId: alert.id, title: product.name, body: MESSAGES[alert.kind] });
      if (!shown.ok) {
        logger.warn("alert notification failed", { alertId: alert.id, detail: shown.error.detail });
      }
    }
  }
  if (previousCheapestListingId !== product.cheapestListingId) {
    await repository.products.setCheapest(productId, previousCheapestListingId);
  }
  return alerts;
};

/**
 * Fetches every listing to scan through its store plugin, records a price snapshot or the failure, tracks listing
 * and plugin health, raises alerts and notifies them.
 *
 * @remarks
 * - **What is fetched.** The active and stale listings of products that are not archived. Plugins run in parallel
 *   and each plugin's listings one at a time; per-domain rate limits, timeouts and saving the raw page of a
 *   `parse_failed` fetch are the `StoreGateway`'s job.
 * - **Snapshots.** A successful fetch appends a snapshot quoted for the saved ship-to country.
 * - **Listing health.** A success makes the listing active and resets both streaks. Any failure adds one to its
 *   failure streak, and the third in a row makes it stale. A `not_found` also adds one to its not-found streak,
 *   which any other result resets, and the second in a row makes it gone; gone listings are never fetched again.
 * - **Plugin backoff.** A `blocked` fetch stops the plugin's scan, adds one to its consecutive blocks and backs it
 *   off for 15 minutes, doubling with each consecutive block up to 24 hours. A plugin still backing off is not
 *   fetched. Any successful fetch clears the blocks and the backoff; other failures leave them as they are.
 * - **Scan runs.** Each plugin with listings records one run, timed by the clock: `blocked` when it was backing off
 *   or a fetch was blocked, else `ok` when any fetch succeeded, else `failed` with the last store error.
 * - **Alerts.** After every plugin finished, each product's fetched listings are evaluated one at a time in scan
 *   order, against their snapshots of the last 30 days and the latest stored exchange rates. The cheapest listing
 *   found feeds into the next evaluation, so one scan raises at most one new cheapest alert per product, and is
 *   stored on the product when it changed. Without stored rates no new cheapest is computed. Each alert gets an id
 *   and is stored before it is notified; an alert the notifier cannot show stays stored and is logged.
 * - A listing removed while the scan runs is left out.
 *
 * @param deps - The ports to use.
 * @returns Each plugin's run and counts, the alerts raised and the listings whose status changed.
 */
export const scanListings = async (deps: ScanDeps): Promise<ScanReport> => {
  const { repository } = deps;
  const settings = await repository.settings.get();
  const listings = await repository.listings.listToScan();
  const scans = await Promise.all(
    [...Map.groupBy(listings, (row) => row.pluginId)].map(async ([pluginId, rows]) =>
      scanPlugin(deps, settings, pluginId, rows),
    ),
  );
  const rates = await repository.fxRates.latest();
  const alerts: Alert[] = [];
  const fetched = Map.groupBy(
    scans.flatMap((scan) => scan.fetched),
    (row) => row.listing.productId,
  );
  for (const [productId, rows] of fetched) {
    alerts.push(...(await evaluateProduct(deps, settings, rates, productId, rows)));
  }
  return {
    plugins: scans.map(({ run, succeeded, failed }) => ({ run, succeeded, failed })),
    alerts,
    transitions: scans.flatMap((scan) => scan.transitions),
  };
};
