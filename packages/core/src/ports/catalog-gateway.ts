import type { CatalogEntry, CatalogError, Result } from "@fpving/plugin-sdk";
import type { PluginId } from "../ids.js";

/** Reaches the catalog plugins. Methods resolve to a `Result` and never reject. */
export interface CatalogGateway {
  /** The ids of the loaded catalog plugins. */
  plugins(): PluginId[];
  /** Searches one catalog for entries matching `text`. */
  search(pluginId: PluginId, text: string): Promise<Result<CatalogEntry[], CatalogError>>;
  /** Fetches one catalog entry by its key, or null when the catalog has none. */
  get(pluginId: PluginId, key: string): Promise<Result<CatalogEntry | null, CatalogError>>;
}
