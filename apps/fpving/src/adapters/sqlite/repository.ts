import {
  alertSchema,
  cachedVerdictSchema,
  CandidateStatus,
  DEFAULT_SETTINGS,
  err,
  listingSchema,
  ListingStatus,
  ok,
  pluginHealthSchema,
  productSchema,
  RepositoryErrorKind,
  scanRunSchema,
  settingsSchema,
} from "@fpving/core";
import type { DuplicateUrl, Listing, NotFound, PriceSnapshot, Repository, Result } from "@fpving/core";
import Database from "better-sqlite3";
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  fromCandidateRow,
  fromFxRow,
  fromSettingsRow,
  fromSnapshotRow,
  toCandidateRow,
  toFxRow,
  toSettingsRow,
  toSnapshotRow,
} from "./mapping.js";
import {
  alerts,
  fxTables,
  listings,
  matchCandidates,
  pluginHealth,
  priceSnapshots,
  products,
  scanRuns,
  settings,
  SETTINGS_ROW_ID,
  verdictCache,
} from "./schema.js";

const Constraint = {
  Unique: "SQLITE_CONSTRAINT_UNIQUE",
  ForeignKey: "SQLITE_CONSTRAINT_FOREIGNKEY",
} as const;

const notFound: NotFound = { kind: RepositoryErrorKind.NotFound };
const duplicateUrl: DuplicateUrl = { kind: RepositoryErrorKind.DuplicateUrl };
const done = ok(undefined);
const LATEST_RANK = 1;
const BUSY_TIMEOUT_MS = 5000;
const SCANNED_STATUSES = [ListingStatus.Active, ListingStatus.Stale];
const ACTIVE = { status: ListingStatus.Active, failureStreak: 0, notFoundStreak: 0 };

const settle = async <T>(work: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(work());
  });

const changedOne = ({ changes }: Database.RunResult): Result<void, NotFound> => (changes === 0 ? err(notFound) : done);

const bug = (message: string): never => {
  throw new Error(message);
};

/**
 * Opens the SQLite database at `path`, which must already be migrated, with foreign keys enforced, in write-ahead log
 * mode, and waiting up to five seconds for a lock held by another connection.
 *
 * @param path - The database file.
 * @returns The repository and a function that closes the database.
 */
export const openSqliteRepository = (path: string): { repository: Repository; close: () => void } => {
  const client = new Database(path, { timeout: BUSY_TIMEOUT_MS });
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  const db = drizzle({ client });
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  const atomically = async <E>(
    work: (tx: Tx) => Result<void, E>,
    refusals: ReadonlyMap<string, E>,
  ): Promise<Result<void, E>> =>
    settle(() => {
      try {
        return db.transaction(work);
      } catch (error) {
        const refusal = error instanceof Database.SqliteError ? refusals.get(error.code) : undefined;
        if (refusal === undefined) {
          throw error;
        }
        return err(refusal);
      }
    });

  const insertListing = (tx: Tx, listing: Listing, firstSnapshot: PriceSnapshot): Result<void, never> => {
    if (firstSnapshot.listingId !== listing.id) {
      bug("first snapshot belongs to another listing");
    }
    tx.insert(listings).values(listing).run();
    tx.insert(priceSnapshots).values(toSnapshotRow(firstSnapshot)).run();
    return done;
  };

  const isLive = (tx: Tx, productId: string): boolean =>
    tx.select({ archivedAt: products.archivedAt }).from(products).where(eq(products.id, productId)).get()
      ?.archivedAt === null;

  const updateLive = (id: string, change: Partial<typeof products.$inferInsert>): Result<void, NotFound> =>
    changedOne(db.update(products).set(change).where(and(eq(products.id, id), isNull(products.archivedAt))).run());

  const pendingCandidates = (filter?: SQL) =>
    db.select().from(matchCandidates).where(and(eq(matchCandidates.status, CandidateStatus.Pending), filter))
      .orderBy(desc(matchCandidates.similarity), asc(matchCandidates.id))
      .all()
      .map(fromCandidateRow);

  const urlRefusals = new Map<string, DuplicateUrl>([[Constraint.Unique, duplicateUrl]]);

  const repository: Repository = {
    products: {
      add: async (product, firstListing, firstSnapshot) =>
        atomically((tx) => {
          if (firstListing.productId !== product.id) {
            bug("first listing belongs to another product");
          }
          if (product.cheapestListingId !== null) {
            bug("a new product has no cheapest listing yet");
          }
          tx.insert(products).values(product).run();
          return insertListing(tx, firstListing, firstSnapshot);
        }, urlRefusals),
      get: async (id) =>
        settle(() => {
          const row = db.select().from(products).where(eq(products.id, id)).get();
          return row === undefined ? null : productSchema.parse(row);
        }),
      list: async () =>
        settle(() =>
          db.select().from(products).where(isNull(products.archivedAt))
            .orderBy(desc(products.createdAt), desc(products.id))
            .all()
            .map((row) => productSchema.parse(row))),
      rename: async (id, name) => settle(() => updateLive(id, { name })),
      archive: async (id, archivedAt) => settle(() => updateLive(id, { archivedAt })),
      restore: async (id, snapshot) =>
        atomically((tx) => {
          const restored = changedOne(tx.update(products).set({ archivedAt: null })
            .where(and(eq(products.id, id), isNotNull(products.archivedAt))).run());
          if (restored.ok) {
            const listing = changedOne(tx.update(listings).set(ACTIVE)
              .where(and(eq(listings.id, snapshot.listingId), eq(listings.productId, id))).run());
            if (!listing.ok) {
              bug("restoring with a snapshot of another product's listing");
            }
            tx.insert(priceSnapshots).values(toSnapshotRow(snapshot)).run();
          }
          return restored;
        }, new Map<string, NotFound>()),
      setCheapest: async (id, cheapestListingId) =>
        atomically((tx) => {
          const updated = changedOne(
            tx.update(products).set({ cheapestListingId }).where(eq(products.id, id)).run(),
          );
          if (updated.ok && cheapestListingId !== null) {
            const owner = tx.select({ productId: listings.productId }).from(listings)
              .where(eq(listings.id, cheapestListingId)).get();
            if (owner?.productId !== id) {
              bug("cheapest listing is another product's");
            }
          }
          return updated;
        }, new Map<string, NotFound>()),
    },
    listings: {
      addWithSnapshot: async (listing, firstSnapshot) =>
        atomically<NotFound | DuplicateUrl>(
          (tx) => (isLive(tx, listing.productId) ? insertListing(tx, listing, firstSnapshot) : err(notFound)),
          urlRefusals,
        ),
      findByUrl: async (url) =>
        settle(() => {
          const row = db.select().from(listings).where(eq(listings.url, url)).get();
          return row === undefined ? null : listingSchema.parse(row);
        }),
      listByProduct: async (productId) =>
        settle(() =>
          db.select().from(listings).where(eq(listings.productId, productId)).orderBy(asc(listings.addedAt)).all()
            .map((row) => listingSchema.parse(row))),
      listToScan: async () =>
        settle(() =>
          db.select(getTableColumns(listings)).from(listings)
            .innerJoin(products, eq(products.id, listings.productId))
            .where(and(isNull(products.archivedAt), inArray(listings.status, SCANNED_STATUSES)))
            .orderBy(asc(listings.pluginId), asc(listings.productId), asc(listings.addedAt))
            .all()
            .map((row) => listingSchema.parse(row))),
      remove: async (productId, id) =>
        atomically((tx) => {
          const removed = changedOne(tx.update(listings).set({ status: ListingStatus.Removed }).where(and(
            eq(listings.id, id),
            eq(listings.productId, productId),
            ne(listings.status, ListingStatus.Removed),
          )).run());
          if (removed.ok) {
            tx.update(products).set({ cheapestListingId: null })
              .where(and(eq(products.id, productId), eq(products.cheapestListingId, id)))
              .run();
          }
          return removed;
        }, new Map<string, NotFound>()),
      restore: async (productId, snapshot) =>
        atomically((tx) => {
          const restored = isLive(tx, productId)
            ? changedOne(tx.update(listings).set(ACTIVE).where(and(
                eq(listings.id, snapshot.listingId),
                eq(listings.productId, productId),
                eq(listings.status, ListingStatus.Removed),
              )).run())
            : err(notFound);
          if (restored.ok) {
            tx.insert(priceSnapshots).values(toSnapshotRow(snapshot)).run();
          }
          return restored;
        }, new Map<string, NotFound>()),
      updateStatus: async (id, update) =>
        settle(() => {
          const status = sql`case when ${listings.status} = ${ListingStatus.Removed} then ${listings.status}
            else ${update.status} end`;
          return changedOne(db.update(listings).set({ ...update, status }).where(eq(listings.id, id)).run());
        }),
    },
    snapshots: {
      append: async (snapshot) =>
        atomically((tx) => {
          tx.insert(priceSnapshots).values(toSnapshotRow(snapshot)).run();
          return done;
        }, new Map<string, NotFound>([[Constraint.ForeignKey, notFound]])),
      listSince: async (listingId, since) =>
        settle(() =>
          db.select().from(priceSnapshots)
            .where(and(eq(priceSnapshots.listingId, listingId), gte(priceSnapshots.observedAt, since)))
            .orderBy(asc(priceSnapshots.observedAt))
            .all()
            .map(fromSnapshotRow)),
      latestPerListing: async (productId) =>
        settle(() => {
          const ranked = db.select({
            ...getTableColumns(priceSnapshots),
            rank: sql<number>`row_number() over (
              partition by ${priceSnapshots.listingId}
              order by ${priceSnapshots.observedAt} desc, ${priceSnapshots.id} desc
            )`.as("rank"),
          }).from(priceSnapshots)
            .innerJoin(listings, eq(listings.id, priceSnapshots.listingId))
            .where(eq(listings.productId, productId))
            .as("ranked");
          return db.select().from(ranked).where(eq(ranked.rank, LATEST_RANK)).all().map(fromSnapshotRow);
        }),
    },
    matchCandidates: {
      save: async (candidates) =>
        atomically((tx) => {
          for (const candidate of candidates) {
            tx.insert(matchCandidates).values(toCandidateRow(candidate)).run();
          }
          return done;
        }, urlRefusals),
      listPending: async () => settle(() => pendingCandidates()),
      listPendingFor: async (productId) => settle(() => pendingCandidates(eq(matchCandidates.productId, productId))),
      accept: async (id, listing, firstSnapshot) =>
        atomically<NotFound | DuplicateUrl>((tx) => {
          const pending = and(eq(matchCandidates.id, id), eq(matchCandidates.status, CandidateStatus.Pending));
          const decided = tx.select({ productId: matchCandidates.productId }).from(matchCandidates)
            .where(pending).get();
          if (decided === undefined || !isLive(tx, decided.productId)) {
            return err(notFound);
          }
          tx.update(matchCandidates).set({ status: CandidateStatus.Accepted }).where(pending).run();
          if (listing.productId !== decided.productId) {
            bug("listing belongs to another product than the candidate");
          }
          return insertListing(tx, listing, firstSnapshot);
        }, urlRefusals),
      recordVerdict: async (id, { verdict, reason }) =>
        settle(() =>
          changedOne(
            db.update(matchCandidates).set({ llmVerdict: verdict, llmReason: reason })
              .where(and(eq(matchCandidates.id, id), eq(matchCandidates.status, CandidateStatus.Pending)))
              .run(),
          )),
      reject: async (id) =>
        settle(() =>
          changedOne(
            db.update(matchCandidates).set({ status: CandidateStatus.Rejected })
              .where(and(eq(matchCandidates.id, id), eq(matchCandidates.status, CandidateStatus.Pending)))
              .run(),
          )),
      isKnownUrl: async (productId, url) =>
        settle(() =>
          db.select({ id: listings.id }).from(listings).where(eq(listings.url, url)).get() !== undefined
          || db.select({ id: matchCandidates.id }).from(matchCandidates)
            .where(and(eq(matchCandidates.productId, productId), eq(matchCandidates.url, url)))
            .get() !== undefined),
    },
    verdictCache: {
      get: async (sourceUrl, candidateUrl) =>
        settle(() => {
          const row = db.select().from(verdictCache)
            .where(and(eq(verdictCache.sourceUrl, sourceUrl), eq(verdictCache.candidateUrl, candidateUrl)))
            .get();
          return row === undefined ? null : cachedVerdictSchema.parse(row);
        }),
      put: async (entry) =>
        settle(() => {
          db.insert(verdictCache).values(entry)
            .onConflictDoUpdate({ target: [verdictCache.sourceUrl, verdictCache.candidateUrl], set: entry })
            .run();
        }),
    },
    alerts: {
      save: async (alert) =>
        settle(() => {
          db.insert(alerts).values(alert).run();
        }),
      list: async ({ unreadOnly }) =>
        settle(() =>
          db.select().from(alerts).where(unreadOnly ? isNull(alerts.readAt) : undefined)
            .orderBy(desc(alerts.createdAt), desc(alerts.id))
            .all()
            .map((row) => alertSchema.parse(row))),
      markRead: async (id, at) =>
        settle(() => changedOne(db.update(alerts).set({ readAt: at }).where(eq(alerts.id, id)).run())),
      markAllRead: async (at) =>
        settle(() => db.update(alerts).set({ readAt: at }).where(isNull(alerts.readAt)).run().changes),
    },
    scanRuns: {
      record: async (run) =>
        settle(() => {
          db.insert(scanRuns).values(run).run();
        }),
      latest: async (pluginId) =>
        settle(() => {
          const row = db.select().from(scanRuns)
            .where(pluginId === undefined ? undefined : eq(scanRuns.pluginId, pluginId))
            .orderBy(desc(scanRuns.startedAt), desc(scanRuns.id))
            .get();
          return row === undefined ? null : scanRunSchema.parse(row);
        }),
    },
    fxRates: {
      save: async (table) =>
        settle(() => {
          db.insert(fxTables).values(toFxRow(table)).run();
        }),
      latest: async () =>
        settle(() => {
          const row = db.select().from(fxTables).orderBy(desc(fxTables.id)).get();
          return row === undefined ? null : fromFxRow(row);
        }),
    },
    pluginHealth: {
      get: async (pluginId) =>
        settle(() =>
          pluginHealthSchema.parse(
            db.select().from(pluginHealth).where(eq(pluginHealth.pluginId, pluginId)).get()
            ?? { pluginId, consecutiveBlocks: 0, backoffUntil: null },
          )),
      upsert: async (health) =>
        settle(() => {
          db.insert(pluginHealth).values(health)
            .onConflictDoUpdate({ target: pluginHealth.pluginId, set: health })
            .run();
        }),
    },
    settings: {
      get: async () =>
        settle(() => {
          const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID)).get();
          return row === undefined ? settingsSchema.parse(DEFAULT_SETTINGS) : fromSettingsRow(row);
        }),
      save: async (next) =>
        settle(() => {
          const row = toSettingsRow(next);
          db.insert(settings).values(row).onConflictDoUpdate({ target: settings.id, set: row }).run();
        }),
    },
  };

  return {
    repository,
    close: () => {
      client.close();
    },
  };
};
