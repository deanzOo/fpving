import type { PluginId, StoreGateway } from "@fpving/core";
import type { PluginManifest } from "@fpving/plugin-sdk";
import { PluginIssueKind, PluginStatusKind } from "./status.js";
import type { PluginIssue, PluginStatus } from "./status.js";

/** A plugin whose manifest passed the schema and the SDK check. */
export interface CompatiblePlugin {
  readonly id: PluginId;
  readonly domains: Readonly<PluginManifest["domains"]>;
}

export type DomainRegistry = Pick<StoreGateway, "declaredDomains" | "pluginFor">;

export interface RegisteredPlugins<P extends CompatiblePlugin> {
  readonly registry: DomainRegistry;
  /** One status per input plugin, in input order. */
  readonly statuses: readonly { readonly plugin: P; readonly status: PluginStatus }[];
}

const sharingId = (plugins: readonly CompatiblePlugin[], id: PluginId): number =>
  plugins.filter((plugin) => plugin.id === id).length;

const claimDomains = (plugins: readonly CompatiblePlugin[]): Map<string, PluginId[]> => {
  const claims = new Map<string, PluginId[]>();
  for (const { id, domains } of plugins) {
    for (const domain of new Set(domains)) {
      claims.set(domain, [...(claims.get(domain) ?? []), id]);
    }
  }
  return claims;
};

const conflictsOf = (plugin: CompatiblePlugin, claims: ReadonlyMap<string, readonly PluginId[]>): PluginIssue[] =>
  [...claims].flatMap(([domain, ids]) =>
    ids.length > 1 && ids.includes(plugin.id)
      ? [{
          kind: PluginIssueKind.DomainConflict,
          detail: `${domain} is also declared by ${ids.filter((id) => id !== plugin.id).join(", ")}`,
        }]
      : [],
  );

const statusOf = (plugin: CompatiblePlugin, claims: ReadonlyMap<string, readonly PluginId[]>): PluginStatus => {
  const conflicts = conflictsOf(plugin, claims);
  if (conflicts.length < new Set(plugin.domains).size) {
    return { kind: PluginStatusKind.Loaded, warnings: conflicts };
  }
  const detail = conflicts.map((conflict) => conflict.detail).join("; ");
  return { kind: PluginStatusKind.Disabled, reason: { kind: PluginIssueKind.DomainConflict, detail } };
};

/**
 * Maps hostnames to the plugins that declare them. Pure. Plugins that share an id are all disabled. A hostname that
 * two or more plugins declare goes to none of them, with a warning on each, so the result never depends on load
 * order; a plugin left with no hostname is disabled.
 *
 * @param plugins - The compatible plugins, in load order; each status carries its input plugin back.
 * @returns The registry and one status per plugin.
 */
export const buildDomainRegistry = <P extends CompatiblePlugin>(plugins: readonly P[]): RegisteredPlugins<P> => {
  const unique = plugins.filter(({ id }) => sharingId(plugins, id) === 1);
  const claims = claimDomains(unique);
  const owners = new Map<string, PluginId>();
  for (const [domain, [owner, ...others]] of claims) {
    if (owner !== undefined && others.length === 0) {
      owners.set(domain, owner);
    }
  }
  const domains = [...owners.keys()].sort();
  const statuses = plugins.map((plugin) => {
    const count = sharingId(plugins, plugin.id);
    const status: PluginStatus = count === 1
      ? statusOf(plugin, claims)
      : {
          kind: PluginStatusKind.Disabled,
          reason: { kind: PluginIssueKind.DuplicateId, detail: `${String(count)} plugins have the id ${plugin.id}` },
        };
    return { plugin, status };
  });
  return {
    registry: {
      declaredDomains: () => domains,
      pluginFor: (url) => {
        const hostname = URL.parse(url)?.hostname;
        return hostname === undefined ? null : (owners.get(hostname) ?? null);
      },
    },
    statuses,
  };
};
