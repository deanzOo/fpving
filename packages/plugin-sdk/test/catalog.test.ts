import { describe, expect, it } from "vitest";
import { catalogEntrySchema, catalogManifestSchema, PluginKind } from "../src/catalog.ts";
import { manifestSchema, PluginCapability } from "../src/manifest.ts";

const catalogManifest = {
  kind: PluginKind.Catalog,
  id: "example-catalog",
  displayName: "Example Catalog",
  version: "1.0.0",
  sdkVersion: ">=0.2.0 <1.0.0",
};

const storeManifest = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.2.3",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["example.com"],
  capabilities: [PluginCapability.FetchListing],
};

describe("Catalog manifest", () => {
  it("accepts a catalog manifest without domains or capabilities", () => {
    expect(catalogManifestSchema.parse(catalogManifest)).toEqual(catalogManifest);
  });

  it("rejects a catalog manifest that also lists domains", () => {
    expect(catalogManifestSchema.safeParse({ ...catalogManifest, domains: ["example.com"] }).success).toBe(false);
  });

  it.each([
    ["id", { id: "Bad_Id" }],
    ["version", { version: "1" }],
    ["sdkVersion", { sdkVersion: "*" }],
    ["displayName", { displayName: "" }],
  ])("rejects a catalog manifest with an invalid %s", (_field, override) => {
    expect(catalogManifestSchema.safeParse({ ...catalogManifest, ...override }).success).toBe(false);
  });

  it("leaves store manifests valid without a kind", () => {
    expect(manifestSchema.safeParse(storeManifest).success).toBe(true);
    expect(catalogManifestSchema.safeParse(storeManifest).success).toBe(false);
  });
});

describe("Catalog entry", () => {
  it("accepts an entry with valid specs", () => {
    const specs = { kind: "radio", rcLink: "elrs-2g4" };
    const entry = { key: "radiomaster-pocket", name: "RadioMaster Pocket", specs };
    expect(catalogEntrySchema.parse(entry)).toEqual(entry);
  });

  it("rejects an entry whose specs break the vocabulary", () => {
    const entry = { key: "x", name: "X", specs: { kind: "radio", rcLink: "bluetooth" } };
    expect(catalogEntrySchema.safeParse(entry).success).toBe(false);
  });

  it.each([
    ["an empty key", { key: "", name: "X" }],
    ["an empty name", { key: "x", name: "" }],
  ])("rejects an entry with %s", (_, fields) => {
    expect(catalogEntrySchema.safeParse({ ...fields, specs: { kind: "radio" } }).success).toBe(false);
  });
});
