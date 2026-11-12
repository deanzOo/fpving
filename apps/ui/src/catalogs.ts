import { apiRoutes } from "@fpving/app/api-routes";
import type { PluginRow } from "@fpving/app/api-routes";
import { HttpStatus } from "@fpving/app/http-status";
import { catalogManifestSchema } from "@fpving/plugin-sdk";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";

/** Whether the catalogs can be searched: not known yet, none installed, installed but none answering, or ready. */
export const CatalogState = { Loading: "loading", None: "none", Unavailable: "unavailable", Ready: "ready" } as const;
type CatalogState = (typeof CatalogState)[keyof typeof CatalogState];

type CatalogRow = PluginRow & { readonly manifest: z.output<typeof catalogManifestSchema> };

const { Loaded } = apiRoutes.listPlugins.schema.response[HttpStatus.Ok].element.shape.status.enum;

const isCatalog = (row: PluginRow): row is CatalogRow => catalogManifestSchema.safeParse(row.manifest).success;

const stateOf = (rows: readonly PluginRow[] | undefined): CatalogState => {
  if (rows === undefined) {
    return CatalogState.Loading;
  }
  const catalogs = rows.filter(isCatalog);
  if (catalogs.length === 0) {
    return CatalogState.None;
  }
  return catalogs.some(({ status, backoffUntil }) => status === Loaded && backoffUntil === null)
    ? CatalogState.Ready
    : CatalogState.Unavailable;
};

/**
 * The installed catalog plugins, from the plugins list: whether they can be searched, and a catalog's display name by
 * its plugin id, the id itself for one the list does not name.
 *
 * @returns The state and the name lookup.
 */
export const useCatalogs = () => {
  const client = useClient();
  const rows = useQuery({
    queryKey: QueryKey.Plugins,
    queryFn: async () => client.listPlugins(),
    throwOnError: true,
  }).data;
  const names = new Map(rows?.filter(isCatalog).map(({ manifest }) => [manifest.id, manifest.displayName]));
  return { state: stateOf(rows), nameOf: (pluginId: string): string => names.get(pluginId) ?? pluginId };
};

/** Looks up a catalog's display name by its plugin id. */
export type NameOf = ReturnType<typeof useCatalogs>["nameOf"];
