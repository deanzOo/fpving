import { pluginIdSchema } from "@fpving/core";
import type { DebugSink, PluginId, StoreGateway } from "@fpving/core";
import { err, PluginCapability, StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, Logger, PluginManifest, StoreResult } from "@fpving/plugin-sdk";
import type { PluginHost } from "./runtime/host.js";
import { PluginStatusKind } from "./status.js";

/** Why the gateway answered a call itself, without reaching a plugin worker. Stable, so scans log one reason. */
export const GatewayRefusal = {
  Unavailable: "the plugin is not loaded",
  SearchNotDeclared: "the plugin does not declare search",
} as const;

/** The part of the plugin host the gateway uses. */
export type GatewayHost = Pick<PluginHost, "registry" | "plugins" | "fetchListing" | "search">;

/** What {@link createPluginStoreGateway} needs. */
export interface PluginStoreGatewayOptions {
  readonly host: GatewayHost;
  readonly debugSink: DebugSink;
  readonly logger: Logger;
}

const refuse = (detail: string): StoreResult<never> => err({ kind: StoreErrorKind.Network, detail });

/**
 * Implements core's `StoreGateway` over the plugin host. Domains come from the registry, so a plugin disabled at run
 * time keeps them and a pasted URL still names it. A call to a plugin that is not loaded now, or a search through one
 * whose manifest does not declare it, resolves to a `network` error with a {@link GatewayRefusal} detail and never
 * reaches a worker. The raw page of a `parse_failed` fetch goes to the debug sink; a failed save is logged and does
 * not change the result.
 *
 * @param options - The running host, the debug sink and the logger.
 * @returns The gateway.
 */
export const createPluginStoreGateway = (options: PluginStoreGatewayOptions): StoreGateway => {
  const { host, debugSink, logger } = options;
  const loadedManifests = (): PluginManifest[] => host.plugins().flatMap(({ manifest, status }) =>
    manifest !== null && status.kind === PluginStatusKind.Loaded ? [manifest] : []);
  const loaded = (pluginId: PluginId): PluginManifest | undefined =>
    loadedManifests().find((manifest) => manifest.id === pluginId);
  const declaresSearch = (manifest: PluginManifest): boolean =>
    manifest.capabilities.includes(PluginCapability.Search);

  const saveRawPage = async (pluginId: PluginId, url: string, result: StoreResult<FetchedListing>): Promise<void> => {
    if (result.ok || result.error.kind !== StoreErrorKind.ParseFailed || result.error.rawPage === undefined) {
      return;
    }
    const saved = await debugSink.savePage(pluginId, url, result.error.rawPage);
    if (!saved.ok) {
      logger.warn("could not save the debug page", { pluginId, url, detail: saved.error.detail });
    }
  };

  return {
    declaredDomains: () => host.registry.declaredDomains(),
    pluginFor: (url) => host.registry.pluginFor(url),
    fetchListing: async (pluginId, url) => {
      if (loaded(pluginId) === undefined) {
        return refuse(GatewayRefusal.Unavailable);
      }
      const result = await host.fetchListing(pluginId, url);
      await saveRawPage(pluginId, url, result);
      return result;
    },
    search: async (pluginId, query) => {
      const manifest = loaded(pluginId);
      if (manifest === undefined) {
        return refuse(GatewayRefusal.Unavailable);
      }
      return declaresSearch(manifest) ? host.search(pluginId, query) : refuse(GatewayRefusal.SearchNotDeclared);
    },
    searchablePlugins: () => loadedManifests().filter(declaresSearch).map(({ id }) => pluginIdSchema.parse(id)),
  };
};
