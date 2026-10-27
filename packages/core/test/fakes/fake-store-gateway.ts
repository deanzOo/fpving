import type { FetchedListing, SearchCandidate, SearchQuery, StoreResult } from "@fpving/plugin-sdk";
import type { PluginId, StoreGateway } from "../../src/index.ts";

interface FakePlugin {
  id: PluginId;
  domains: string[];
  listing: StoreResult<FetchedListing>;
  search?: StoreResult<SearchCandidate[]>;
}

/** A {@link StoreGateway} over scripted plugins that records every fetched url and every search. */
export const fakeStoreGateway = (
  plugins: FakePlugin[],
  onFetch: () => Promise<void> = async () => Promise.resolve(),
): StoreGateway & { fetched: string[]; searched: { pluginId: PluginId; query: SearchQuery }[] } => {
  const fetched: string[] = [];
  const searched: { pluginId: PluginId; query: SearchQuery }[] = [];
  const plugin = (id: PluginId): FakePlugin => {
    const found = plugins.find((row) => row.id === id);
    if (found === undefined) {
      throw new Error(`no plugin ${id}`);
    }
    return found;
  };
  return {
    fetched,
    searched,
    declaredDomains: () => plugins.flatMap((row) => row.domains),
    pluginFor: (url) => plugins.find((row) => row.domains.includes(new URL(url).hostname))?.id ?? null,
    fetchListing: async (id, url) => {
      fetched.push(url);
      await onFetch();
      return plugin(id).listing;
    },
    search: async (id, query) => {
      searched.push({ pluginId: id, query });
      const { search } = plugin(id);
      return search ?? Promise.reject(new Error(`plugin ${id} cannot search`));
    },
    searchablePlugins: () => plugins.filter((row) => row.search !== undefined).map((row) => row.id),
  };
};
