import { err, ok } from "@fpving/plugin-sdk";
import { CandidateStatus, DEFAULT_SETTINGS, ListingStatus, RepositoryErrorKind } from "../../src/index.ts";
import type {
  Alert,
  CachedVerdict,
  DuplicateUrl,
  FxTable,
  Listing,
  MatchCandidate,
  NotFound,
  PluginHealth,
  PriceSnapshot,
  Product,
  Repository,
  Result,
  ScanRun,
  Settings,
} from "../../src/index.ts";

const notFound = err({ kind: RepositoryErrorKind.NotFound });
const duplicateUrl = err({ kind: RepositoryErrorKind.DuplicateUrl });
const done = ok(undefined);
const copy = structuredClone;

const bug = async (message: string): Promise<never> => Promise.reject(new Error(message));

const byCodePoint = (a: string, b: string): number => Number(a > b) - Number(a < b);

const newestFirst = <T extends { readonly id: string }>(rows: Iterable<T>, at: (row: T) => Date): T[] =>
  [...rows].toSorted((a, b) => at(b).getTime() - at(a).getTime() || byCodePoint(b.id, a.id));

/** A {@link Repository} held in memory that enforces references and unique ids the way a database would, for tests. */
export const inMemoryRepository = (): Repository => {
  const products = new Map<string, Product>();
  const listings = new Map<string, Listing>();
  const snapshots = new Map<string, PriceSnapshot>();
  const candidates = new Map<string, MatchCandidate>();
  const verdicts = new Map<string, CachedVerdict>();
  const alerts = new Map<string, Alert>();
  const scanRuns = new Map<string, ScanRun>();
  const health = new Map<string, PluginHealth>();
  let fxTable: FxTable | null = null;
  let settings: Settings = copy(DEFAULT_SETTINGS);

  const urlTracked = (url: string): boolean => [...listings.values()].some((row) => row.url === url);
  const suggested = (row: Pick<MatchCandidate, "productId" | "url">, pool: Iterable<MatchCandidate>): boolean =>
    [...pool].some((other) => other.productId === row.productId && other.url === row.url);

  const insertListing = async (
    listing: Listing,
    firstSnapshot: PriceSnapshot,
  ): Promise<Result<void, NotFound | DuplicateUrl>> => {
    if (listings.has(listing.id) || snapshots.has(firstSnapshot.id)) {
      return bug("duplicate id");
    }
    if (!products.has(listing.productId)) {
      return Promise.resolve(notFound);
    }
    if (urlTracked(listing.url)) {
      return Promise.resolve(duplicateUrl);
    }
    listings.set(listing.id, copy(listing));
    snapshots.set(firstSnapshot.id, copy(firstSnapshot));
    return Promise.resolve(done);
  };

  return {
    products: {
      add: async (product, firstListing, firstSnapshot) => {
        if (firstListing.productId !== product.id || firstSnapshot.listingId !== firstListing.id) {
          return bug("first listing or snapshot belongs to another row");
        }
        if (product.cheapestListingId !== null) {
          return bug("a new product has no cheapest listing yet");
        }
        if (products.has(product.id) || listings.has(firstListing.id) || snapshots.has(firstSnapshot.id)) {
          return bug("duplicate id");
        }
        if (urlTracked(firstListing.url)) {
          return Promise.resolve(duplicateUrl);
        }
        products.set(product.id, copy(product));
        listings.set(firstListing.id, copy(firstListing));
        snapshots.set(firstSnapshot.id, copy(firstSnapshot));
        return Promise.resolve(done);
      },
      get: async (id) => Promise.resolve(copy(products.get(id) ?? null)),
      setCheapest: async (id, cheapestListingId) => {
        const row = products.get(id);
        if (row === undefined) {
          return Promise.resolve(notFound);
        }
        if (cheapestListingId !== null && listings.get(cheapestListingId)?.productId !== id) {
          return bug("cheapest listing is missing or another product's");
        }
        products.set(id, { ...row, cheapestListingId });
        return Promise.resolve(done);
      },
    },
    listings: {
      addWithSnapshot: async (listing, firstSnapshot) =>
        firstSnapshot.listingId === listing.id
          ? insertListing(listing, firstSnapshot)
          : bug("first snapshot belongs to another listing"),
      findByUrl: async (url) => Promise.resolve(copy([...listings.values()].find((row) => row.url === url) ?? null)),
      listByProduct: async (productId) =>
        Promise.resolve(
          copy(
            [...listings.values()]
              .filter((row) => row.productId === productId)
              .toSorted((a, b) => a.addedAt.getTime() - b.addedAt.getTime()),
          ),
        ),
      listToScan: async () =>
        Promise.resolve(
          copy(
            [...listings.values()]
              .filter((row) => row.status !== ListingStatus.Gone && products.get(row.productId)?.archivedAt === null)
              .toSorted(
                (a, b) =>
                  byCodePoint(a.pluginId, b.pluginId)
                  || byCodePoint(a.productId, b.productId)
                  || a.addedAt.getTime() - b.addedAt.getTime(),
              ),
          ),
        ),
      updateStatus: async (id, update) => {
        const row = listings.get(id);
        if (row === undefined) {
          return Promise.resolve(notFound);
        }
        listings.set(id, { ...row, ...update });
        return Promise.resolve(done);
      },
    },
    snapshots: {
      append: async (snapshot) => {
        if (snapshots.has(snapshot.id)) {
          return bug("duplicate snapshot id");
        }
        if (!listings.has(snapshot.listingId)) {
          return Promise.resolve(notFound);
        }
        snapshots.set(snapshot.id, copy(snapshot));
        return Promise.resolve(done);
      },
      listSince: async (listingId, since) =>
        Promise.resolve(
          copy(
            [...snapshots.values()]
              .filter((row) => row.listingId === listingId && row.observedAt >= since)
              .toSorted((a, b) => a.observedAt.getTime() - b.observedAt.getTime()),
          ),
        ),
      latestPerListing: async (productId) => {
        const latest = new Map<string, PriceSnapshot>();
        for (const row of newestFirst(snapshots.values(), (s) => s.observedAt)) {
          if (listings.get(row.listingId)?.productId === productId && !latest.has(row.listingId)) {
            latest.set(row.listingId, row);
          }
        }
        return Promise.resolve(copy([...latest.values()]));
      },
    },
    matchCandidates: {
      save: async (batch) => {
        if (batch.some((row) => !products.has(row.productId))) {
          return bug("candidate for a missing product");
        }
        if (batch.some((row, index) => candidates.has(row.id) || batch.findIndex((o) => o.id === row.id) !== index)) {
          return bug("duplicate candidate id");
        }
        const accepted: MatchCandidate[] = [];
        for (const row of batch) {
          if (suggested(row, candidates.values()) || suggested(row, accepted)) {
            return Promise.resolve(duplicateUrl);
          }
          accepted.push(row);
        }
        for (const row of accepted) {
          candidates.set(row.id, copy(row));
        }
        return Promise.resolve(done);
      },
      listPending: async () =>
        Promise.resolve(
          copy(
            [...candidates.values()]
              .filter((row) => row.status === CandidateStatus.Pending)
              .toSorted((a, b) => b.similarityScore - a.similarityScore || byCodePoint(a.id, b.id)),
          ),
        ),
      accept: async (id, listing, firstSnapshot) => {
        const row = candidates.get(id);
        if (row?.status !== CandidateStatus.Pending) {
          return Promise.resolve(notFound);
        }
        if (listing.productId !== row.productId || firstSnapshot.listingId !== listing.id) {
          return bug("listing or snapshot belongs to another row");
        }
        const inserted = await insertListing(listing, firstSnapshot);
        if (inserted.ok) {
          candidates.set(id, { ...row, status: CandidateStatus.Accepted });
        }
        return inserted;
      },
      recordVerdict: async (id, { verdict, reason }) => {
        const row = candidates.get(id);
        if (row?.status !== CandidateStatus.Pending) {
          return Promise.resolve(notFound);
        }
        candidates.set(id, { ...row, llmVerdict: verdict, llmReason: reason });
        return Promise.resolve(done);
      },
      reject: async (id) => {
        const row = candidates.get(id);
        if (row?.status !== CandidateStatus.Pending) {
          return Promise.resolve(notFound);
        }
        candidates.set(id, { ...row, status: CandidateStatus.Rejected });
        return Promise.resolve(done);
      },
      isKnownUrl: async (productId, url) =>
        Promise.resolve(urlTracked(url) || suggested({ productId, url }, candidates.values())),
    },
    verdictCache: {
      get: async (sourceUrl, candidateUrl) =>
        Promise.resolve(copy(verdicts.get(JSON.stringify([sourceUrl, candidateUrl])) ?? null)),
      put: async (entry) => {
        verdicts.set(JSON.stringify([entry.sourceUrl, entry.candidateUrl]), copy(entry));
        return Promise.resolve();
      },
    },
    alerts: {
      save: async (alert) => {
        const referenced = [alert.afterSnapshotId, alert.beforeSnapshotId ?? alert.afterSnapshotId];
        if (
          !products.has(alert.productId)
          || !listings.has(alert.listingId)
          || referenced.some((id) => !snapshots.has(id))
        ) {
          return bug("alert references a missing row");
        }
        if (alerts.has(alert.id)) {
          return bug("duplicate alert id");
        }
        alerts.set(alert.id, copy(alert));
        return Promise.resolve();
      },
      list: async ({ unreadOnly }) =>
        Promise.resolve(
          copy(newestFirst(alerts.values(), (row) => row.createdAt).filter((row) => !(unreadOnly && row.readAt))),
        ),
      markRead: async (id, at) => {
        const row = alerts.get(id);
        if (row === undefined) {
          return Promise.resolve(notFound);
        }
        alerts.set(id, { ...row, readAt: copy(at) });
        return Promise.resolve(done);
      },
    },
    scanRuns: {
      record: async (run) => {
        if (scanRuns.has(run.id)) {
          return bug("duplicate scan run id");
        }
        scanRuns.set(run.id, copy(run));
        return Promise.resolve();
      },
      latest: async (pluginId) =>
        Promise.resolve(
          copy(
            newestFirst(scanRuns.values(), (row) => row.startedAt).find(
              (row) => pluginId === undefined || row.pluginId === pluginId,
            ) ?? null,
          ),
        ),
    },
    fxRates: {
      save: async (table) => {
        fxTable = copy(table);
        return Promise.resolve();
      },
      latest: async () => Promise.resolve(copy(fxTable)),
    },
    pluginHealth: {
      get: async (pluginId) =>
        Promise.resolve(copy(health.get(pluginId) ?? { pluginId, consecutiveBlocks: 0, backoffUntil: null })),
      upsert: async (row) => {
        health.set(row.pluginId, copy(row));
        return Promise.resolve();
      },
    },
    settings: {
      get: async () => Promise.resolve(copy(settings)),
      save: async (next) => {
        settings = copy(next);
        return Promise.resolve();
      },
    },
  };
};
