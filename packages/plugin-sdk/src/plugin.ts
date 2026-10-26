import type { PluginContext } from "./context.js";
import type { StoreResult } from "./errors.js";
import type { FetchedListing, SearchCandidate } from "./listing.js";
import type { PluginManifest } from "./manifest.js";

/** What the host searches a store for. */
export interface SearchQuery {
  /** Free-text query, usually the product name. */
  readonly text: string;
  /** The product's brand, when known. */
  readonly brand?: string;
  /** The product's model, when known. */
  readonly model?: string;
}

/** One store, bound to a {@link PluginContext}. Methods resolve to a {@link StoreResult} and never reject. */
export interface Store {
  /** Fetches one product page on a domain from the manifest. */
  fetchListing(url: URL): Promise<StoreResult<FetchedListing>>;
  /** Searches the store. Required when the manifest declares the `search` capability, absent otherwise. */
  search?(query: SearchQuery): Promise<StoreResult<SearchCandidate[]>>;
}

/** The module a plugin package exports: its manifest and a store factory. */
export interface StorePlugin {
  /** Describes the plugin; see {@link manifestSchema}. */
  readonly manifest: PluginManifest;
  /** Creates a store bound to the host context. */
  createStore(ctx: PluginContext): Store;
}
