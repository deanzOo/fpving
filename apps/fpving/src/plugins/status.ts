/** Why a plugin, a `plugins.json` entry or the whole file was set aside, or lost one of its domains. */
export const PluginIssueKind = {
  ConfigInvalid: "config_invalid",
  EntryInvalid: "entry_invalid",
  DuplicateEntry: "duplicate_entry",
  ManifestInvalid: "manifest_invalid",
  SdkIncompatible: "sdk_incompatible",
  DuplicateId: "duplicate_id",
  DomainConflict: "domain_conflict",
} as const;

export type PluginIssueKind = (typeof PluginIssueKind)[keyof typeof PluginIssueKind];

export interface PluginIssue {
  readonly kind: PluginIssueKind;
  readonly detail: string;
}

export const PluginStatusKind = { Loaded: "loaded", Disabled: "disabled" } as const;

/** A loaded plugin lists the domains it lost in `warnings`; a disabled one carries the reason. */
export type PluginStatus
  = | { readonly kind: typeof PluginStatusKind.Loaded; readonly warnings: readonly PluginIssue[] }
    | { readonly kind: typeof PluginStatusKind.Disabled; readonly reason: PluginIssue };
