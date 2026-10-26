/**
 * The store plugin contract: plugin types, the schemas the host validates plugin output with, the store error
 * taxonomy, ISO currency and country codes, and `Result`.
 *
 * @module plugin-sdk
 */
export type {
  BrowserDriver,
  BrowserPage,
  Clock,
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
  LogFields,
  Logger,
  PluginContext,
  TransportError,
} from "./context.js";
export { StoreErrorKind, storeErrorSchema } from "./errors.js";
export type { StoreError, StoreResult } from "./errors.js";
export { COUNTRY_CODES, CURRENCY_CODES, CURRENCY_MINOR_UNITS, countryCodeSchema, currencyCodeSchema } from "./iso.js";
export type { CountryCode, CurrencyCode } from "./iso.js";
export {
  fetchedListingSchema,
  searchCandidateSchema,
  ShippingKind,
  ShippingUnknown,
  shippingSchema,
} from "./listing.js";
export type { FetchedListing, SearchCandidate, Shipping } from "./listing.js";
export { manifestSchema, PluginCapability } from "./manifest.js";
export type { PluginManifest } from "./manifest.js";
export { moneySchema, shippingCostSchema } from "./money.js";
export type { Money } from "./money.js";
export type { SearchQuery, Store, StorePlugin } from "./plugin.js";
export { err, ok } from "./result.js";
export type { Result } from "./result.js";
