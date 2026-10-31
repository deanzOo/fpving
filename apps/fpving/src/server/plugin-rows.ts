import { PLUGINS_FILE } from "../plugins/config.js";
import type { PluginsConfig } from "../plugins/config.js";
import type { PluginState } from "../plugins/runtime/host.js";
import { PluginStatusKind } from "../plugins/status.js";
import type { PluginIssue } from "../plugins/status.js";
import type { PluginRow } from "./api-routes.js";

/**
 * The plugins screen rows: one per plugin the host knows, named by its path or package, then one per rejected
 * `plugins.json` entry, named by its index, and one for `plugins.json` itself when it was unusable as a whole.
 *
 * @param states - The plugin host's states.
 * @param rejected - The entries refused before reaching the host.
 * @param configIssue - Why `plugins.json` was unusable, or null.
 * @returns The rows.
 */
export const pluginRows = (
  states: readonly PluginState[],
  rejected: PluginsConfig["rejected"],
  configIssue: PluginIssue | null,
): PluginRow[] => [
  ...states.map(({ entry, manifest, status }) => ({
    source: "path" in entry ? entry.path : entry.package,
    manifest,
    status: status.kind,
    issues: status.kind === PluginStatusKind.Loaded ? [...status.warnings] : [status.reason],
  })),
  ...rejected.map(({ index, issue }) => ({
    source: `${PLUGINS_FILE}[${String(index)}]`,
    manifest: null,
    status: PluginStatusKind.Disabled,
    issues: [issue],
  })),
  ...(configIssue === null
    ? []
    : [{ source: PLUGINS_FILE, manifest: null, status: PluginStatusKind.Disabled, issues: [configIssue] }]),
];
