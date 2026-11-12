import { describe, expect, it } from "vitest";
import { gearSpecsSchema } from "../src/gear.ts";

const TWO = 2;
const FOUR = 4;
const SIX = 6;

describe("Gear specs", () => {
  it("accepts the Boxer Crush as a radio with ELRS 2.4GHz and EdgeTX", () => {
    const radio = { kind: "radio", rcLink: "elrs-2g4", firmware: "edgetx" };
    expect(gearSpecsSchema.parse(radio)).toEqual(radio);
  });

  it("accepts an item with no specs known", () => {
    expect(gearSpecsSchema.parse({ kind: "battery" })).toEqual({ kind: "battery" });
  });

  it("rejects a value outside the vocabulary", () => {
    expect(gearSpecsSchema.safeParse({ kind: "goggles", videoSystems: ["fatshark"] }).success).toBe(false);
  });

  it("rejects a field that belongs to another kind", () => {
    expect(gearSpecsSchema.safeParse({ kind: "tool", cells: 4 }).success).toBe(false);
  });

  it("rejects zero or fractional counts", () => {
    expect(gearSpecsSchema.safeParse({ kind: "battery", cells: 0 }).success).toBe(false);
    expect(gearSpecsSchema.safeParse({ kind: "battery", cells: 1.5 }).success).toBe(false);
  });

  it("rejects an empty or repeated list", () => {
    expect(gearSpecsSchema.safeParse({ kind: "charger", cells: [] }).success).toBe(false);
    expect(gearSpecsSchema.safeParse({ kind: "charger", connectors: ["xt60", "xt60"] }).success).toBe(false);
  });

  it("accepts a fully specified charger and a quad", () => {
    const charger = { kind: "charger", cells: [TWO, FOUR, SIX], connectors: ["xt30", "xt60"], ports: TWO };
    const quad = {
      kind: "quad", sizeClass: "2.5in", cells: 4, connector: "xt30", rcLink: "elrs-2g4", videoSystem: "dji-o4",
    };
    expect(gearSpecsSchema.parse(charger)).toEqual(charger);
    expect(gearSpecsSchema.parse(quad)).toEqual(quad);
  });
});
