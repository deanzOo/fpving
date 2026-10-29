import { StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, SearchCandidate, SearchQuery, StoreResult } from "@fpving/plugin-sdk";
import { err } from "../../src/index.ts";
import type { PluginId, StoreGateway } from "../../src/index.ts";

interface FakePlugin {
  id: PluginId;
  domains: string[];
  listing: StoreResult<FetchedListing>;
  byUrl?: Record<string, StoreResult<FetchedListing>>;
  search?: StoreResult<SearchCandidate[]>;
}

/**
 * A {@link StoreGateway} over scripted plugins that records every fetched url and every search. A fetch answers the
 * plugin's `byUrl` entry for the url, else its `listing`; both are read at call time, so tests can change them. An
 * unknown plugin, or a search through one without `search`, answers a `network` error.
 */
export const fakeStoreGateway = (
  plugins: FakePlugin[],
  onFetch: (url: string) => Promise<void> = async () => Promise.resolve(),
): StoreGateway & { fetched: string[]; searched: { pluginId: PluginId; query: SearchQuery }[] } => {
  const fetched: string[] = [];
  const searched: { pluginId: PluginId; query: SearchQuery }[] = [];
  const missing = (id: PluginId) => err({ kind: StoreErrorKind.Network, detail: `plugin ${id} cannot answer that` });
  const plugin = (id: PluginId): FakePlugin | undefined => plugins.find((row) => row.id === id);
  return {
    fetched,
    searched,
    declaredDomains: () => plugins.flatMap((row) => row.domains),
    pluginFor: (url) => plugins.find((row) => row.domains.includes(new URL(url).hostname))?.id ?? null,
    fetchListing: async (id, url) => {
      fetched.push(url);
      await onFetch(url);
      const found = plugin(id);
      return found === undefined ? missing(id) : (found.byUrl?.[url] ?? found.listing);
    },
    search: async (id, query) => {
      searched.push({ pluginId: id, query });
      return Promise.resolve(plugin(id)?.search ?? missing(id));
    },
    searchablePlugins: () => plugins.filter((row) => row.search !== undefined).map((row) => row.id),
  };
};
