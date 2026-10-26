import { describe, expect, it } from "vitest";
import { manifestSchema, PluginCapability } from "../src/manifest.ts";

const valid = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.2.3",
  sdkVersion: "^0.1.0",
  domains: ["example.com", "shop.example.co.uk"],
  capabilities: [PluginCapability.FetchListing, PluginCapability.Search],
};

const rejects = (override: Record<string, unknown>): boolean =>
  !manifestSchema.safeParse({ ...valid, ...override }).success;

describe("plugin manifest", () => {
  it("accepts a valid manifest", () => {
    expect(manifestSchema.parse(valid)).toEqual(valid);
  });

  it.each(["Example-Shop", "example_shop", ""])("rejects the id %j", (id) => {
    expect(rejects({ id })).toBe(true);
  });

  it("rejects an empty display name", () => {
    expect(rejects({ displayName: "" })).toBe(true);
  });

  it.each(["1.2", "v1.2.3", "latest"])("rejects the non-canonical or invalid version %j", (version) => {
    expect(rejects({ version })).toBe(true);
  });

  it.each([">=0.1.0 <0.3.0", "0.1.x", "^0.1.0 || ^1.0.0"])("accepts the sdk version range %j", (sdkVersion) => {
    expect(rejects({ sdkVersion })).toBe(false);
  });

  it.each(["", " ", "latest"])("rejects the sdk version range %j", (sdkVersion) => {
    expect(rejects({ sdkVersion })).toBe(true);
  });

  it("rejects empty domains", () => {
    expect(rejects({ domains: [] })).toBe(true);
  });

  it.each(["Example.com", "https://example.com", "example.com/shop", "*.example.com", "example.com:8080", "example"])(
    "rejects the domain %j",
    (domain) => {
      expect(rejects({ domains: [domain] })).toBe(true);
    },
  );

  it("rejects an unknown capability", () => {
    expect(rejects({ capabilities: ["teleport"] })).toBe(true);
  });

  it("rejects empty capabilities", () => {
    expect(rejects({ capabilities: [] })).toBe(true);
  });
});
