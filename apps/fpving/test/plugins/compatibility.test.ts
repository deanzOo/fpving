import { err, ok, PluginCapability, SDK_VERSION } from "@fpving/plugin-sdk";
import type { PluginManifest } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { checkSdkCompatibility } from "../../src/plugins/compatibility.ts";
import { PluginIssueKind } from "../../src/plugins/status.ts";

const manifest = (sdkVersion: string): PluginManifest => ({
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.0.0",
  sdkVersion,
  domains: ["shop.example.com"],
  capabilities: [PluginCapability.FetchListing],
});

describe("Plugin SDK compatibility", () => {
  it.each([">=0.0.0 <1.0.0", "^0.1.0 || >=0.0.0 <0.1.0"])("accepts a plugin whose range %j covers the SDK", (range) => {
    expect(checkSdkCompatibility(manifest(range), "0.0.0")).toEqual(ok(undefined));
  });

  it("accepts a plugin tested against the running SDK", () => {
    expect(checkSdkCompatibility(manifest(`>=${SDK_VERSION} <1000.0.0`), SDK_VERSION).ok).toBe(true);
  });

  it("disables a plugin whose range excludes the SDK, naming both versions", () => {
    expect(checkSdkCompatibility(manifest("^1.2.0"), "0.3.0")).toEqual(
      err({
        kind: PluginIssueKind.SdkIncompatible,
        detail: "example-shop needs @fpving/plugin-sdk ^1.2.0, the host has 0.3.0",
      }),
    );
  });
});
