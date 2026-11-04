import { ListingStatus } from "@fpving/core";
import type { Listing, PluginHealth } from "@fpving/core";
import { PLUGINS_FILE } from "../plugins/config.js";
import type { PluginsConfig } from "../plugins/config.js";
import type { PluginState } from "../plugins/runtime/host.js";
import { PluginIssueKind, PluginStatusKind } from "../plugins/status.js";
import type { PluginIssue } from "../plugins/status.js";
import type { PluginRow } from "./api-routes.js";

/** What the plugins screen reads from the repository: every plugin's health and the listings a scan fetches. */
export interface PluginActivity {
  readonly health: readonly PluginHealth[];
  readonly scanned: readonly Listing[];
  readonly now: Date;
}

const NO_ACTIVITY = { backoffUntil: null, staleListings: 0, unscannedListings: 0 } as const;

const UNLISTED_SOURCE = "listings of ";

/** Why a row stands for the listings of a plugin id and not a `plugins.json` entry. */
export const NOT_LISTED = "no plugin in plugins.json provides this id";

const isStale = ({ status }: Listing): boolean => status === ListingStatus.Stale;

const activityOf = (
  { manifest, status }: Pick<PluginState, "manifest" | "status">,
  { health, scanned, now }: PluginActivity,
) => {
  if (manifest === null) {
    return NO_ACTIVITY;
  }
  const own = scanned.filter(({ pluginId }) => pluginId === manifest.id);
  const until = health.find(({ pluginId }) => pluginId === manifest.id)?.backoffUntil ?? null;
  return {
    backoffUntil: until !== null && until > now ? until : null,
    staleListings: own.filter(isStale).length,
    unscannedListings: status.kind === PluginStatusKind.Loaded ? 0 : own.length,
  };
};

const unlistedRows = (states: readonly PluginState[], { scanned }: PluginActivity): PluginRow[] => {
  const known = new Set(states.map(({ manifest }) => manifest?.id));
  const unlisted = [...new Set(scanned.map(({ pluginId }) => pluginId))].filter((id) => !known.has(id));
  return unlisted.map((id) => {
    const own = scanned.filter(({ pluginId }) => pluginId === id);
    return {
      source: `${UNLISTED_SOURCE}${id}`,
      manifest: null,
      status: PluginStatusKind.Disabled,
      issues: [{ kind: PluginIssueKind.NotListed, detail: NOT_LISTED }],
      backoffUntil: null,
      staleListings: own.filter(isStale).length,
      unscannedListings: own.length,
    };
  });
};

/**
 * The plugins screen rows: one per plugin the host knows, named by its path or package, then one per rejected
 * `plugins.json` entry, named by its index, one for `plugins.json` itself when it was unusable as a whole, and one per
 * plugin id with listings to scan that no known plugin reports, such as one removed from `plugins.json`. A plugin that
 * is not loaded counts all its listings to scan as not scanned.
 *
 * @param states - The plugin host's states.
 * @param rejected - The entries refused before reaching the host.
 * @param configIssue - Why `plugins.json` was unusable, or null.
 * @param activity - The plugins' health and scanned listings, for each plugin's backoff, shown only while it lasts,
 * and its stale and not scanned listing counts.
 * @returns The rows.
 */
export const pluginRows = (
  states: readonly PluginState[],
  rejected: PluginsConfig["rejected"],
  configIssue: PluginIssue | null,
  activity: PluginActivity,
): PluginRow[] => [
  ...states.map(({ entry, manifest, status }) => ({
    source: "path" in entry ? entry.path : entry.package,
    manifest,
    status: status.kind,
    issues: status.kind === PluginStatusKind.Loaded ? [...status.warnings] : [status.reason],
    ...activityOf({ manifest, status }, activity),
  })),
  ...rejected.map(({ index, issue }) => ({
    source: `${PLUGINS_FILE}[${String(index)}]`,
    manifest: null,
    status: PluginStatusKind.Disabled,
    issues: [issue],
    ...NO_ACTIVITY,
  })),
  ...(configIssue === null
    ? []
    : [{
        source: PLUGINS_FILE,
        manifest: null,
        status: PluginStatusKind.Disabled,
        issues: [configIssue],
        ...NO_ACTIVITY,
      }]),
  ...unlistedRows(states, activity),
];
