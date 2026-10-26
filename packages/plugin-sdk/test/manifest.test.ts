import { describe, expect, it } from "vitest";
import { MAX_ID_LENGTH, manifestSchema, PluginCapability } from "../src/manifest.ts";

const valid = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.2.3",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["example.com", "shop.example.co.uk"],
  capabilities: [PluginCapability.FetchListing, PluginCapability.Search],
};

const rejects = (override: Record<string, unknown>): boolean =>
  !manifestSchema.safeParse({ ...valid, ...override }).success;

describe("plugin manifest", () => {
  it("accepts a valid manifest", () => {
    expect(manifestSchema.parse(valid)).toEqual(valid);
  });

  it.each(["a", "example-shop-2", "x".repeat(MAX_ID_LENGTH)])("accepts the id %j", (id) => {
    expect(rejects({ id })).toBe(false);
  });

  it.each(["Example-Shop", "example_shop", "", "-", "--x", "a-", "a--b", "x".repeat(MAX_ID_LENGTH + 1)])(
    "rejects the id %j",
    (id) => {
      expect(rejects({ id })).toBe(true);
    },
  );

  it("rejects an empty display name", () => {
    expect(rejects({ displayName: "" })).toBe(true);
  });

  const versions = ["1.2.3", "1.2.3-rc.1", "1.2.3+build.1", "1.2.3-rc.1+build.1"];
  it.each(versions)("accepts the version %j", (version) => {
    expect(rejects({ version })).toBe(false);
  });

  const badVersions = ["1.2", "v1.2.3", "=1.2.3", " 1.2.3", "01.2.3", "latest"];
  it.each(badVersions)("rejects the non-canonical or invalid version %j", (version) => {
    expect(rejects({ version })).toBe(true);
  });

  const ranges = [">=0.0.0 <1.0.0", "0.1.x", "^0.1.0 || ^1.0.0", ">=0.2.0"];
  it.each(ranges)("accepts the sdk version range %j", (sdkVersion) => {
    expect(rejects({ sdkVersion })).toBe(false);
  });

  const badRanges = ["", " ", "latest", "*", "x", ">=0.0.0", "0.x || *"];
  it.each(badRanges)("rejects the blank, invalid or unbounded sdk version range %j", (sdkVersion) => {
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
