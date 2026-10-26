import type { Result } from "@fpving/plugin-sdk";
import type {
  Alert,
  CachedVerdict,
  CandidateStatus,
  Listing,
  MatchCandidate,
  PluginHealth,
  PriceSnapshot,
  Product,
  ScanRun,
  Settings,
} from "../entities.js";
import type { AlertId, ListingId, MatchCandidateId, ProductId } from "../ids.js";
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
  /** Stores a product with its first listing, or neither when the listing url is already tracked. */
  add(product: Product, firstListing: Listing): Promise<Result<void, DuplicateUrl>>;
}

/** The fields of a listing that a fetch outcome changes. */
export type ListingStatusUpdate = Pick<Listing, "status" | "failureStreak" | "notFoundStreak">;

/** Stores listings. Urls are compared exactly, so callers pass them normalized. */
export interface ListingRepository {
  /** Adds a listing to an existing product. */
  add(listing: Listing): Promise<Result<void, NotFound | DuplicateUrl>>;
  /** The listing tracking `url`, or null. */
  findByUrl(url: string): Promise<Listing | null>;
  /** A product's listings, oldest first. */
  listByProduct(productId: ProductId): Promise<Listing[]>;
  /** Replaces a listing's status and streaks. */
  updateStatus(id: ListingId, update: ListingStatusUpdate): Promise<Result<void, NotFound>>;
}

/** Stores price snapshots, append-only. */
export interface SnapshotRepository {
  /** Appends a snapshot of an existing listing. */
  append(snapshot: PriceSnapshot): Promise<Result<void, NotFound>>;
  /** A listing's snapshots observed at or after `since`, oldest first. */
  listSince(listingId: ListingId, since: Date): Promise<PriceSnapshot[]>;
  /** The newest snapshot of each of a product's listings that has one, in no particular order. */
  latestPerListing(productId: ProductId): Promise<PriceSnapshot[]>;
}

/** Stores match candidates. A url is suggested at most once per product. */
export interface MatchCandidateRepository {
  /** Saves all candidates, or none when any url was already suggested for its product. */
  save(candidates: readonly MatchCandidate[]): Promise<Result<void, DuplicateUrl>>;
  /** Every pending candidate, highest similarity first. */
  listPending(): Promise<MatchCandidate[]>;
  /** Records the review decision for a candidate. */
  setStatus(id: MatchCandidateId, status: CandidateStatus): Promise<Result<void, NotFound>>;
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
  /** Alerts newest first; only unread ones when `unreadOnly`. */
  list(filter: { readonly unreadOnly: boolean }): Promise<Alert[]>;
  /** Marks an alert read at `at`. */
  markRead(id: AlertId, at: Date): Promise<Result<void, NotFound>>;
}

/** Stores scan runs. */
export interface ScanRunRepository {
  /** Records a finished scan run. */
  record(run: ScanRun): Promise<void>;
  /** The most recently started run of `pluginId`, or of any plugin when omitted; null when none ran. */
  latest(pluginId?: string): Promise<ScanRun | null>;
}

/** Stores exchange rates. */
export interface FxRateRepository {
  /** Stores a rate table, which becomes the latest. */
  save(table: FxTable): Promise<void>;
  /** The last saved rate table, or null. */
  latest(): Promise<FxTable | null>;
}

/** Stores each plugin's backoff state. */
export interface PluginHealthRepository {
  /** A plugin's health; a plugin without a record has no blocks and no backoff. */
  get(pluginId: string): Promise<PluginHealth>;
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
 * Persistence, one repository per aggregate. Expected refusals resolve to a `Result`; a rejected promise means a
 * bug or a broken store. Every implementation must pass the core repository contract suite.
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
