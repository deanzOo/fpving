export { err, ok } from "@fpving/plugin-sdk";
export type {
  Amount,
  BrowserDriver,
  Clock,
  CountryCode,
  CurrencyCode,
  HttpClient,
  Logger,
  Money,
  Result,
} from "@fpving/plugin-sdk";
export { evaluate } from "./alerts/evaluate.js";
export type { Evaluation, EvaluateInput } from "./alerts/evaluate.js";
export type { AlertDraft, AlertSettings, ListingWithLatest } from "./alerts/draft.js";
export { MatchErrorKind } from "./matching/errors.js";
export { findMatches, rejudgeUnjudged } from "./matching/find.js";
export type { FailedSearch, FindMatchesError, MatchDeps, MatchReport, NoSourceListing } from "./matching/find.js";
export { acceptCandidate, rejectCandidate } from "./matching/review.js";
export type { AcceptCandidateError, NotPending } from "./matching/review.js";
export { addListing, addProduct } from "./products/add.js";
export type {
  AddDeps,
  AddedListing,
  AddedProduct,
  AddListingError,
  AddProductError,
  AlreadyTracked,
  FetchFailed,
  NoPluginForDomain,
} from "./products/add.js";
export { AddErrorKind } from "./products/errors.js";
export { normalizeListingUrl } from "./products/normalize-url.js";
export type { InvalidUrl } from "./products/normalize-url.js";
export { COUNTRY_PRESETS, presetFor } from "./pricing/country-presets.js";
export type { CountryPreset, PresetSource } from "./pricing/country-presets.js";
export { convert } from "./pricing/fx.js";
export type { FxTable, MissingRate, PricingError } from "./pricing/fx.js";
export { importTax, ThresholdBasis } from "./pricing/import-tax.js";
export type { ImportTaxRule } from "./pricing/import-tax.js";
export { landedCost } from "./pricing/landed-cost.js";
export type { PricingSettings, ShippingUnknownError } from "./pricing/landed-cost.js";
export { PricingErrorKind } from "./pricing/errors.js";
export type { AmountOutOfRange } from "./pricing/money.js";
export {
  AlertKind,
  alertSchema,
  cachedVerdictSchema,
  CandidateStatus,
  DEFAULT_SETTINGS,
  ListingOrigin,
  listingSchema,
  ListingStatus,
  LlmVerdict,
  matchCandidateSchema,
  pluginHealthSchema,
  priceSnapshotSchema,
  productSchema,
  ScanOutcome,
  scanRunSchema,
  settingsSchema,
  verdictSchema,
} from "./entities.js";
export type {
  Alert,
  CachedVerdict,
  DeepReadonly,
  Listing,
  MatchCandidate,
  PluginHealth,
  PriceSnapshot,
  Product,
  ScanRun,
  Settings,
  Verdict,
} from "./entities.js";
export {
  alertIdSchema,
  listingIdSchema,
  matchCandidateIdSchema,
  pluginIdSchema,
  productIdSchema,
  scanRunIdSchema,
  snapshotIdSchema,
} from "./ids.js";
export type { AlertId, ListingId, MatchCandidateId, PluginId, ProductId, ScanRunId, SnapshotId } from "./ids.js";
export { PortErrorKind } from "./ports/errors.js";
export type { RatesUnavailable, CurrencyRates } from "./ports/currency-rates.js";
export type { DebugSink, DebugWriteFailed } from "./ports/debug-sink.js";
export type { IdGenerator } from "./ports/id-generator.js";
export { LlmErrorKind, productIdentitySchema } from "./ports/llm-judge.js";
export type { LlmError, LlmJudge, ProductIdentity } from "./ports/llm-judge.js";
export type { AlertNotification, Notifier, NotifyFailed } from "./ports/notifier.js";
export { RepositoryErrorKind } from "./ports/repository.js";
export type {
  AlertRepository,
  DuplicateUrl,
  FxRateRepository,
  ListingRepository,
  ListingStatusUpdate,
  MatchCandidateRepository,
  NotFound,
  PluginHealthRepository,
  ProductRepository,
  Repository,
  ScanRunRepository,
  SettingsRepository,
  SnapshotRepository,
  VerdictCacheRepository,
} from "./ports/repository.js";
export type { Scheduler } from "./ports/scheduler.js";
export type { StoreGateway } from "./ports/store-gateway.js";
export { scanListings } from "./scan/scan.js";
export type { ListingTransition, PluginScan, ScanDeps, ScanReport } from "./scan/scan.js";
export { nextScanDue, RatesRefresh, refreshRatesIfStale } from "./scheduler/policy.js";
export type { RefreshRatesDeps } from "./scheduler/policy.js";
