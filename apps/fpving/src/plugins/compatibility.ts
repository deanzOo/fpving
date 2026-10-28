import { err, ok, satisfiesSemverRange } from "@fpving/plugin-sdk";
import type { PluginManifest, Result } from "@fpving/plugin-sdk";
import { PluginIssueKind } from "./status.js";
import type { PluginIssue } from "./status.js";

/**
 * Checks that the running SDK lies in the manifest's `sdkVersion` range. Pure.
 *
 * @param manifest - A manifest that already passed `manifestSchema`.
 * @param sdkVersion - The host's `SDK_VERSION`.
 * @returns Ok, or `sdk_incompatible` naming the range and the host's version.
 */
export const checkSdkCompatibility = (
  manifest: PluginManifest,
  sdkVersion: string,
): Result<undefined, PluginIssue> =>
  satisfiesSemverRange(sdkVersion, manifest.sdkVersion)
    ? ok(undefined)
    : err({
        kind: PluginIssueKind.SdkIncompatible,
        detail: `${manifest.id} needs @fpving/plugin-sdk ${manifest.sdkVersion}, the host has ${sdkVersion}`,
      });
