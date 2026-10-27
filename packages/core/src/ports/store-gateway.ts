import type { FetchedListing, SearchCandidate, SearchQuery, StoreResult } from "@fpving/plugin-sdk";
import type { PluginId } from "../ids.js";

/**
 * The loaded store plugins, as core sees them. The plugin host implements it; core never calls a plugin directly.
 * URLs are absolute http(s) strings and every method that reaches a store resolves to a `StoreResult` and never
 * rejects.
 */
export interface StoreGateway {
  /** Every hostname a loaded plugin declares in its manifest, so URLs can be normalized onto them. */
  declaredDomains(): readonly string[];
  /** The plugin whose manifest declares the URL's hostname exactly, or null. Pass a normalized URL. */
  pluginFor(url: string): PluginId | null;
  /** Fetches one product page through the plugin `pluginId`. */
  fetchListing(pluginId: PluginId, url: string): Promise<StoreResult<FetchedListing>>;
  /** Searches the store of `pluginId`, which must be one of {@link StoreGateway.searchablePlugins}. */
  search(pluginId: PluginId, query: SearchQuery): Promise<StoreResult<SearchCandidate[]>>;
  /** The loaded plugins that declare the `search` capability. */
  searchablePlugins(): readonly PluginId[];
}
