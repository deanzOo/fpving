import { ok } from "@fpving/plugin-sdk";
import type { CatalogEntry, CatalogError, Result } from "@fpving/plugin-sdk";
import type { PluginId } from "../ids.js";
import type { CatalogGateway } from "../ports/catalog-gateway.js";

/** A {@link CatalogGateway} over fixed entries per plugin, where search matches a name containing the text. */
export class FakeCatalogGateway implements CatalogGateway {
  public constructor(private readonly entries: ReadonlyMap<PluginId, readonly CatalogEntry[]>) {}

  public plugins(): PluginId[] {
    return [...this.entries.keys()];
  }

  public async search(pluginId: PluginId, text: string): Promise<Result<CatalogEntry[], CatalogError>> {
    const needle = text.toLowerCase();
    return Promise.resolve(
      ok((this.entries.get(pluginId) ?? []).filter((entry) => entry.name.toLowerCase().includes(needle))),
    );
  }

  public async get(pluginId: PluginId, key: string): Promise<Result<CatalogEntry | null, CatalogError>> {
    return Promise.resolve(ok((this.entries.get(pluginId) ?? []).find((entry) => entry.key === key) ?? null));
  }
}
