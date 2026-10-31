import { ListingStatus } from "@fpving/core";
import type { Listing, PluginHealth } from "@fpving/core";
import type { PluginManifest } from "@fpving/plugin-sdk";
import { PLUGINS_FILE } from "../plugins/config.js";
import type { PluginsConfig } from "../plugins/config.js";
import type { PluginState } from "../plugins/runtime/host.js";
import { PluginStatusKind } from "../plugins/status.js";
import type { PluginIssue } from "../plugins/status.js";
import type { PluginRow } from "./api-routes.js";

/** What the plugins screen reads from the repository: every plugin's health and the listings a scan fetches. */
export interface PluginActivity {
  readonly health: readonly PluginHealth[];
  readonly scanned: readonly Listing[];
  readonly now: Date;
}

const NO_ACTIVITY = { backoffUntil: null, staleListings: 0 } as const;

const activityOf = (manifest: PluginManifest | null, { health, scanned, now }: PluginActivity) => {
  if (manifest === null) {
    return NO_ACTIVITY;
  }
  const until = health.find(({ pluginId }) => pluginId === manifest.id)?.backoffUntil ?? null;
  return {
    backoffUntil: until !== null && until > now ? until : null,
    staleListings: scanned.filter(({ pluginId, status }) => pluginId === manifest.id && status === ListingStatus.Stale)
      .length,
  };
};

/**
 * The plugins screen rows: one per plugin the host knows, named by its path or package, then one per rejected
 * `plugins.json` entry, named by its index, and one for `plugins.json` itself when it was unusable as a whole.
 *
 * @param states - The plugin host's states.
 * @param rejected - The entries refused before reaching the host.
 * @param configIssue - Why `plugins.json` was unusable, or null.
 * @param activity - The plugins' health and scanned listings, for each plugin's backoff, shown only while it lasts,
 * and its stale listing count.
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
    ...activityOf(manifest, activity),
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
];
