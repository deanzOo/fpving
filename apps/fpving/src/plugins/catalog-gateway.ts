import type { CatalogGateway } from "@fpving/core";
import type { PluginHost } from "./runtime/host.js";

/** The part of the plugin host the catalog gateway uses. */
export type CatalogHost = Pick<PluginHost, "catalogPlugins" | "searchCatalog" | "getCatalogEntry">;

/**
 * Implements core's `CatalogGateway` over the plugin host's catalog plugins. The host is read on every call, so a
 * settings change that replaces it is followed.
 *
 * @param host - The running host now.
 * @returns The gateway.
 */
export const createPluginCatalogGateway = (host: () => CatalogHost): CatalogGateway => ({
  plugins: () => host().catalogPlugins(),
  search: async (pluginId, text) => host().searchCatalog(pluginId, text),
  get: async (pluginId, key) => host().getCatalogEntry(pluginId, key),
});
