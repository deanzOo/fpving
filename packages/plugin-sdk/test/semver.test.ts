import { describe, expect, it } from "vitest";
import { satisfiesSemverRange } from "../src/semver.ts";

describe("Semver range satisfaction", () => {
  it.each([
    ["0.0.0", ">=0.0.0 <1.0.0"],
    ["0.1.5", "^0.1.0"],
    ["1.2.3", "1.2.3"],
    ["2.0.1", "^0.1.0 || ^2.0.0"],
  ])("accepts the version %j for the range %j", (version, range) => {
    expect(satisfiesSemverRange(version, range)).toBe(true);
  });

  it.each([
    ["1.0.0", ">=0.0.0 <1.0.0"],
    ["0.2.0", "^0.1.0"],
    ["0.1.0-rc.1", "^0.1.0"],
    ["latest", ">=0.0.0 <1.0.0"],
    ["1.0.0", "not a range"],
  ])("rejects the version %j for the range %j", (version, range) => {
    expect(satisfiesSemverRange(version, range)).toBe(false);
  });
});
