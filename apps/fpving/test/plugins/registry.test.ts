import { pluginIdSchema } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { buildDomainRegistry } from "../../src/plugins/registry.ts";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";

const SHOP = pluginIdSchema.parse("example-shop");
const OTHER = pluginIdSchema.parse("other-shop");
const THIRD = pluginIdSchema.parse("third-shop");
const LOADED = { kind: PluginStatusKind.Loaded, warnings: [] };

const idsOf = (statuses: ReturnType<typeof buildDomainRegistry>["statuses"]) =>
  statuses.map(({ plugin, status }) => ({ id: plugin.id, status }));

describe("Plugin domain registry", () => {
  it("maps each declared hostname to its plugin and lists the hostnames sorted", () => {
    const { registry, statuses } = buildDomainRegistry([
      { id: SHOP, domains: ["shop.example.com", "example.co.uk"] },
      { id: OTHER, domains: ["other.example"] },
    ]);
    expect(registry.declaredDomains()).toEqual(["example.co.uk", "other.example", "shop.example.com"]);
    expect(registry.pluginFor("https://shop.example.com/p/1?x=1")).toBe(SHOP);
    expect(registry.pluginFor("https://other.example/p/2")).toBe(OTHER);
    expect(idsOf(statuses)).toEqual([
      { id: SHOP, status: LOADED },
      { id: OTHER, status: LOADED },
    ]);
  });

  it.each([
    ["a subdomain of a declared hostname", "https://www.shop.example.com/p/1"],
    ["a parent of a declared hostname", "https://example.com/p/1"],
    ["an undeclared hostname", "https://elsewhere.example/p/1"],
    ["a string that is not a URL", "shop.example.com/p/1"],
  ])("finds no plugin for %s, because only an exact hostname matches", (_name, url) => {
    expect(buildDomainRegistry([{ id: SHOP, domains: ["shop.example.com"] }]).registry.pluginFor(url)).toBeNull();
  });

  it("gives a hostname two plugins declare to neither, and warns both", () => {
    const { registry, statuses } = buildDomainRegistry([
      { id: SHOP, domains: ["shop.example.com", "shared.example"] },
      { id: OTHER, domains: ["shared.example", "other.example"] },
    ]);
    expect(registry.pluginFor("https://shared.example/p/1")).toBeNull();
    expect(registry.declaredDomains()).toEqual(["other.example", "shop.example.com"]);
    const conflict = (by: string): object => ({
      kind: PluginIssueKind.DomainConflict,
      detail: `shared.example is also declared by ${by}`,
    });
    expect(idsOf(statuses)).toEqual([
      { id: SHOP, status: { kind: PluginStatusKind.Loaded, warnings: [conflict(OTHER)] } },
      { id: OTHER, status: { kind: PluginStatusKind.Loaded, warnings: [conflict(SHOP)] } },
    ]);
  });

  it("disables a plugin that loses every hostname to conflicts", () => {
    const { registry, statuses } = buildDomainRegistry([
      { id: SHOP, domains: ["shared.example"] },
      { id: OTHER, domains: ["shared.example", "other.example"] },
      { id: THIRD, domains: ["shared.example"] },
    ]);
    expect(registry.declaredDomains()).toEqual(["other.example"]);
    expect(idsOf(statuses)[0]).toEqual({
      id: SHOP,
      status: {
        kind: PluginStatusKind.Disabled,
        reason: {
          kind: PluginIssueKind.DomainConflict,
          detail: "shared.example is also declared by other-shop, third-shop",
        },
      },
    });
    expect(statuses[1]?.status.kind).toBe(PluginStatusKind.Loaded);
  });

  it("does not let a plugin conflict with itself over a hostname it lists twice", () => {
    const twice = { id: SHOP, domains: ["shop.example.com", "shop.example.com"] } as const;
    const { registry, statuses } = buildDomainRegistry([twice]);
    expect(registry.declaredDomains()).toEqual(["shop.example.com"]);
    expect(idsOf(statuses)).toEqual([{ id: SHOP, status: LOADED }]);
  });

  it("disables every plugin that shares an id, so their hostnames go to no one and conflict with no one", () => {
    const { registry, statuses } = buildDomainRegistry([
      { id: SHOP, domains: ["shop.example.com"] },
      { id: OTHER, domains: ["shop.example.com"] },
      { id: SHOP, domains: ["shop.example.org"] },
    ]);
    expect(registry.declaredDomains()).toEqual(["shop.example.com"]);
    expect(registry.pluginFor("https://shop.example.com/")).toBe(OTHER);
    const duplicate = {
      kind: PluginStatusKind.Disabled,
      reason: { kind: PluginIssueKind.DuplicateId, detail: "2 plugins have the id example-shop" },
    };
    expect(idsOf(statuses)).toEqual([
      { id: SHOP, status: duplicate },
      { id: OTHER, status: LOADED },
      { id: SHOP, status: duplicate },
    ]);
  });

  it("is empty when no plugin is loaded", () => {
    const { registry, statuses } = buildDomainRegistry([]);
    expect(registry.declaredDomains()).toEqual([]);
    expect(registry.pluginFor("https://shop.example.com/")).toBeNull();
    expect(idsOf(statuses)).toEqual([]);
  });
});
