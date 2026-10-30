import type { Result } from "@fpving/plugin-sdk";
import type {
  Alert,
  CachedVerdict,
  Listing,
  MatchCandidate,
  PluginHealth,
  PriceSnapshot,
  Product,
  ScanRun,
  Settings,
  Verdict,
} from "../entities.js";
import type { AlertId, ListingId, MatchCandidateId, PluginId, ProductId } from "../ids.js";
import type { FxTable } from "../pricing/fx.js";

/** Why a repository call was refused: the referenced row does not exist, or the url is already taken. */
export const RepositoryErrorKind = { NotFound: "not_found", DuplicateUrl: "duplicate_url" } as const;

/** One of the {@link RepositoryErrorKind} values. */
export type RepositoryErrorKind = (typeof RepositoryErrorKind)[keyof typeof RepositoryErrorKind];

/** The row a call refers to does not exist. */
export interface NotFound {
  readonly kind: typeof RepositoryErrorKind.NotFound;
}

/** A listing already tracks the url, or the url was already suggested for the product. */
export interface DuplicateUrl {
  readonly kind: typeof RepositoryErrorKind.DuplicateUrl;
}

/** Stores products. */
export interface ProductRepository {
  /**
   * Stores a product with its first listing and first snapshot, or none of them when the listing url is already
   * tracked. Rejects when the listing is not the product's, the snapshot not the listing's, or the product already
   * names a cheapest listing: a new product's `cheapestListingId` must be null.
   */
  add(product: Product, firstListing: Listing, firstSnapshot: PriceSnapshot): Promise<Result<void, DuplicateUrl>>;
  /** The product with id `id`, archived or not, or null. */
  get(id: ProductId): Promise<Product | null>;
  /**
   * The products that are not archived, newest first. Of products created at the same instant, the one with the
   * greater id by code point comes first.
   */
  list(): Promise<Product[]>;
  /** Replaces the name of a product that is not archived. */
  rename(id: ProductId, name: string): Promise<Result<void, NotFound>>;
  /** Archives a product that is not archived yet at `at`; it then counts as gone everywhere but {@link get}. */
  archive(id: ProductId, at: Date): Promise<Result<void, NotFound>>;
  /**
   * Replaces a product's cheapest listing, or clears it with null. Rejects when the listing does not exist or is
   * another product's.
   */
  setCheapest(id: ProductId, listingId: ListingId | null): Promise<Result<void, NotFound>>;
}

/** The fields of a listing that a fetch outcome changes. */
export type ListingStatusUpdate = Pick<Listing, "status" | "failureStreak" | "notFoundStreak">;

/** Stores listings. Urls are compared exactly, so callers pass them normalized. */
export interface ListingRepository {
  /**
   * Adds a listing to an existing product that is not archived together with its first snapshot, or neither of
   * them: a missing or archived product is `not_found`. Rejects when the snapshot is not the listing's.
   */
  addWithSnapshot(listing: Listing, firstSnapshot: PriceSnapshot): Promise<Result<void, NotFound | DuplicateUrl>>;
  /** The listing tracking `url`, or null. */
  findByUrl(url: string): Promise<Listing | null>;
  /** A product's listings, oldest first. */
  listByProduct(productId: ProductId): Promise<Listing[]>;
  /**
   * The listings a scan fetches: the active and stale ones of products that are not archived, ordered by plugin id,
   * then product id, then oldest first. Ids compare by code point.
   */
  listToScan(): Promise<Listing[]>;
  /** Replaces a listing's status and streaks; a removed listing stays removed, so a running scan cannot revive it. */
  updateStatus(id: ListingId, update: ListingStatusUpdate): Promise<Result<void, NotFound>>;
  /**
   * Marks a listing of the product `productId` that is not removed yet removed, keeping its snapshots and alerts,
   * and clears the product's cheapest listing when it was this one, in one step.
   */
  remove(productId: ProductId, id: ListingId): Promise<Result<void, NotFound>>;
}

/** Stores price snapshots, append-only. */
export interface SnapshotRepository {
  /** Appends a snapshot of an existing listing. */
  append(snapshot: PriceSnapshot): Promise<Result<void, NotFound>>;
  /** A listing's snapshots observed at or after `since`, oldest first. */
  listSince(listingId: ListingId, since: Date): Promise<PriceSnapshot[]>;
  /**
   * The newest snapshot of each of a product's listings that has one, in no particular order. Of snapshots observed
   * at the same instant, the one with the greater id by code point is the newest.
   */
  latestPerListing(productId: ProductId): Promise<PriceSnapshot[]>;
}

/**
 * Stores match candidates. A url is suggested at most once per product. Only a pending candidate can be accepted,
 * rejected or given a verdict; a decided one is refused with `not_found`, like a missing one.
 */
export interface MatchCandidateRepository {
  /** Saves all candidates, or none when any url was already suggested for its product. */
  save(candidates: readonly MatchCandidate[]): Promise<Result<void, DuplicateUrl>>;
  /** Every pending candidate, highest similarity first, equal similarities by id in code point order. */
  listPending(): Promise<MatchCandidate[]>;
  /** A product's pending candidates, in the order of {@link MatchCandidateRepository.listPending}. */
  listPendingFor(productId: ProductId): Promise<MatchCandidate[]>;
  /**
   * Marks a pending candidate accepted and adds its listing with the listing's first snapshot in one step, or does
   * none of it: a candidate that is not pending, or whose product is archived, is `not_found`. Rejects when the
   * listing is not for the candidate's product or the snapshot not the listing's.
   */
  accept(
    id: MatchCandidateId,
    listing: Listing,
    firstSnapshot: PriceSnapshot,
  ): Promise<Result<void, NotFound | DuplicateUrl>>;
  /** Replaces a pending candidate's verdict and reason with the ones the LLM gave. */
  recordVerdict(id: MatchCandidateId, verdict: Verdict): Promise<Result<void, NotFound>>;
  /** Marks a pending candidate rejected, so its url is never suggested for the product again. */
  reject(id: MatchCandidateId): Promise<Result<void, NotFound>>;
  /** Whether `url` was already suggested for the product, whatever its status, or is tracked by any listing. */
  isKnownUrl(productId: ProductId, url: string): Promise<boolean>;
}

/** Caches LLM verdicts by source and candidate url, in that order. */
export interface VerdictCacheRepository {
  /** The cached verdict for the pair, or null. */
  get(sourceUrl: string, candidateUrl: string): Promise<CachedVerdict | null>;
  /** Stores a verdict, replacing any earlier one for the same pair. */
  put(entry: CachedVerdict): Promise<void>;
}

/** Stores alerts. */
export interface AlertRepository {
  /** Stores a new alert. */
  save(alert: Alert): Promise<void>;
  /**
   * Alerts newest first; only unread ones when `unreadOnly`. Of alerts created at the same instant, the one with the
   * greater id by code point comes first.
   */
  list(filter: { readonly unreadOnly: boolean }): Promise<Alert[]>;
  /** Marks an alert read at `at`. */
  markRead(id: AlertId, at: Date): Promise<Result<void, NotFound>>;
  /** Marks every unread alert read at `at` in one step and resolves to how many there were. */
  markAllRead(at: Date): Promise<number>;
}

/** Stores scan runs. */
export interface ScanRunRepository {
  /** Records a finished scan run. */
  record(run: ScanRun): Promise<void>;
  /**
   * The most recently started run of `pluginId`, or of any plugin when omitted; null when none ran. Of runs started
   * at the same instant, the one with the greater id by code point wins.
   */
  latest(pluginId?: PluginId): Promise<ScanRun | null>;
}

/** Stores exchange rates. */
export interface FxRateRepository {
  /** Stores a rate table, which becomes the latest whatever its date. */
  save(table: FxTable): Promise<void>;
  /** The last saved rate table, not the one with the newest date, or null. */
  latest(): Promise<FxTable | null>;
}

/** Stores each plugin's backoff state. */
export interface PluginHealthRepository {
  /** A plugin's health; a plugin without a record has no blocks and no backoff. */
  get(pluginId: PluginId): Promise<PluginHealth>;
  /** Stores a plugin's health, replacing its earlier record. */
  upsert(health: PluginHealth): Promise<void>;
}

/** Stores the settings singleton. */
export interface SettingsRepository {
  /** The saved settings, or `DEFAULT_SETTINGS` before any were saved. */
  get(): Promise<Settings>;
  /** Replaces the settings. */
  save(settings: Settings): Promise<void>;
}

/**
 * Persistence, one repository per aggregate. Every implementation must pass the core repository contract suite.
 *
 * @remarks
 * - Each method is atomic: it stores everything it was given or nothing.
 * - Expected refusals resolve to a `Result`: `duplicate_url`, and `not_found` for an id the caller may hold after
 *   it was removed or never existed (a listing's product, a snapshot's listing, a candidate to decide, a row to
 *   update).
 * - Every other broken reference, such as an alert naming a missing snapshot or a candidate for a missing product,
 *   and an id that is already stored are bugs: the promise rejects.
 * - Instants are UTC `Date`s, stored as integer epoch milliseconds, so they round-trip to the millisecond. The
 *   order of rows with equal instants is unspecified, except where a method names an id tiebreak.
 */
export interface Repository {
  /** Products. */
  readonly products: ProductRepository;
  /** Listings. */
  readonly listings: ListingRepository;
  /** Price snapshots. */
  readonly snapshots: SnapshotRepository;
  /** Match candidates. */
  readonly matchCandidates: MatchCandidateRepository;
  /** LLM verdict cache. */
  readonly verdictCache: VerdictCacheRepository;
  /** Alerts. */
  readonly alerts: AlertRepository;
  /** Scan runs. */
  readonly scanRuns: ScanRunRepository;
  /** Exchange rates. */
  readonly fxRates: FxRateRepository;
  /** Plugin health. */
  readonly pluginHealth: PluginHealthRepository;
  /** Settings. */
  readonly settings: SettingsRepository;
}
