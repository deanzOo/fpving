import { describe, expect, it } from "vitest";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";
import { pluginRows } from "../../src/server/plugin-rows.ts";

const warning = { kind: PluginIssueKind.DomainConflict, detail: "shop.example is claimed twice" };

describe("Plugins screen rows", () => {
  it("names a package entry by its package and lists a loaded plugin's warnings", () => {
    const state = {
      entry: { package: "@acme/fpving-shop" },
      manifest: null,
      status: { kind: PluginStatusKind.Loaded, warnings: [warning] },
    };
    expect(pluginRows([state], [], null)).toEqual([
      { source: "@acme/fpving-shop", manifest: null, status: PluginStatusKind.Loaded, issues: [warning] },
    ]);
  });

  it("lists a disabled plugin with its reason", () => {
    const reason = { kind: PluginIssueKind.Crashed, detail: "exited twice" };
    const status = { kind: PluginStatusKind.Disabled, reason };
    const state = { entry: { path: "/plugins/a" }, manifest: null, status };
    expect(pluginRows([state], [], null)).toEqual([
      { source: "/plugins/a", manifest: null, status: PluginStatusKind.Disabled, issues: [reason] },
    ]);
  });
});
