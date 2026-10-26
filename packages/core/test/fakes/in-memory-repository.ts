import { err, ok } from "@fpving/plugin-sdk";
import { CandidateStatus, DEFAULT_SETTINGS, RepositoryErrorKind } from "../../src/index.ts";
import type {
  Alert,
  CachedVerdict,
  FxTable,
  Listing,
  MatchCandidate,
  PluginHealth,
  PriceSnapshot,
  Product,
  Repository,
  ScanRun,
  Settings,
} from "../../src/index.ts";

const notFound = err({ kind: RepositoryErrorKind.NotFound });
const duplicateUrl = err({ kind: RepositoryErrorKind.DuplicateUrl });
const done = ok(undefined);

const newestFirst = <T>(rows: T[], at: (row: T) => Date): T[] =>
  rows.toSorted((a, b) => at(b).getTime() - at(a).getTime());

/** A {@link Repository} held in memory, for tests. */
export const inMemoryRepository = (): Repository => {
  const products = new Map<string, Product>();
  const listings = new Map<string, Listing>();
  const snapshots: PriceSnapshot[] = [];
  const candidates = new Map<string, MatchCandidate>();
  const verdicts = new Map<string, CachedVerdict>();
  const alerts = new Map<string, Alert>();
  const scanRuns: ScanRun[] = [];
  const health = new Map<string, PluginHealth>();
  let fxTable: FxTable | null = null;
  let settings: Settings = DEFAULT_SETTINGS;

  const urlTracked = (url: string): boolean => [...listings.values()].some((row) => row.url === url);
  const suggested = (row: Pick<MatchCandidate, "productId" | "url">, pool: Iterable<MatchCandidate>): boolean =>
    [...pool].some((other) => other.productId === row.productId && other.url === row.url);

  return {
    products: {
      add: async (product, firstListing) => {
        if (urlTracked(firstListing.url)) {
          return Promise.resolve(duplicateUrl);
        }
        products.set(product.id, product);
        listings.set(firstListing.id, firstListing);
        return Promise.resolve(done);
      },
    },
    listings: {
      add: async (listing) => {
        if (!products.has(listing.productId)) {
          return Promise.resolve(notFound);
        }
        if (urlTracked(listing.url)) {
          return Promise.resolve(duplicateUrl);
        }
        listings.set(listing.id, listing);
        return Promise.resolve(done);
      },
      findByUrl: async (url) => Promise.resolve([...listings.values()].find((row) => row.url === url) ?? null),
      listByProduct: async (productId) =>
        Promise.resolve(
          [...listings.values()]
            .filter((row) => row.productId === productId)
            .toSorted((a, b) => a.addedAt.getTime() - b.addedAt.getTime()),
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
        if (!listings.has(snapshot.listingId)) {
          return Promise.resolve(notFound);
        }
        snapshots.push(snapshot);
        return Promise.resolve(done);
      },
      listSince: async (listingId, since) =>
        Promise.resolve(
          snapshots
            .filter((row) => row.listingId === listingId && row.observedAt >= since)
            .toSorted((a, b) => a.observedAt.getTime() - b.observedAt.getTime()),
        ),
      latestPerListing: async (productId) => {
        const latest = new Map<string, PriceSnapshot>();
        for (const row of newestFirst(snapshots, (s) => s.observedAt)) {
          if (listings.get(row.listingId)?.productId === productId && !latest.has(row.listingId)) {
            latest.set(row.listingId, row);
          }
        }
        return Promise.resolve([...latest.values()]);
      },
    },
    matchCandidates: {
      save: async (batch) => {
        const accepted: MatchCandidate[] = [];
        for (const row of batch) {
          if (suggested(row, candidates.values()) || suggested(row, accepted)) {
            return Promise.resolve(duplicateUrl);
          }
          accepted.push(row);
        }
        for (const row of accepted) {
          candidates.set(row.id, row);
        }
        return Promise.resolve(done);
      },
      listPending: async () =>
        Promise.resolve(
          [...candidates.values()]
            .filter((row) => row.status === CandidateStatus.Pending)
            .toSorted((a, b) => b.similarityScore - a.similarityScore),
        ),
      setStatus: async (id, status) => {
        const row = candidates.get(id);
        if (row === undefined) {
          return Promise.resolve(notFound);
        }
        candidates.set(id, { ...row, status });
        return Promise.resolve(done);
      },
      isKnownUrl: async (productId, url) =>
        Promise.resolve(urlTracked(url) || suggested({ productId, url }, candidates.values())),
    },
    verdictCache: {
      get: async (sourceUrl, candidateUrl) =>
        Promise.resolve(verdicts.get(JSON.stringify([sourceUrl, candidateUrl])) ?? null),
      put: async (entry) => {
        verdicts.set(JSON.stringify([entry.sourceUrl, entry.candidateUrl]), entry);
        return Promise.resolve();
      },
    },
    alerts: {
      save: async (alert) => {
        alerts.set(alert.id, alert);
        return Promise.resolve();
      },
      list: async ({ unreadOnly }) =>
        Promise.resolve(
          newestFirst([...alerts.values()], (row) => row.createdAt).filter((row) => !unreadOnly || row.readAt === null),
        ),
      markRead: async (id, at) => {
        const row = alerts.get(id);
        if (row === undefined) {
          return Promise.resolve(notFound);
        }
        alerts.set(id, { ...row, readAt: at });
        return Promise.resolve(done);
      },
    },
    scanRuns: {
      record: async (run) => {
        scanRuns.push(run);
        return Promise.resolve();
      },
      latest: async (pluginId) =>
        Promise.resolve(
          newestFirst(scanRuns, (row) => row.startedAt).find(
            (row) => pluginId === undefined || row.pluginId === pluginId,
          ) ?? null,
        ),
    },
    fxRates: {
      save: async (table) => {
        fxTable = table;
        return Promise.resolve();
      },
      latest: async () => Promise.resolve(fxTable),
    },
    pluginHealth: {
      get: async (pluginId) =>
        Promise.resolve(health.get(pluginId) ?? { pluginId, consecutiveBlocks: 0, backoffUntil: null }),
      upsert: async (row) => {
        health.set(row.pluginId, row);
        return Promise.resolve();
      },
    },
    settings: {
      get: async () => Promise.resolve(settings),
      save: async (next) => {
        settings = next;
        return Promise.resolve();
      },
    },
  };
};
