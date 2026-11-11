import { GearKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { gearItemSchema, pluginIdSchema, SpecSource, specsOf } from "../../src/index.ts";

const CATALOG = pluginIdSchema.parse("example-catalog");
const CELLS = 4;

const battery = (specs: Record<string, unknown>): unknown => ({
  id: "b1",
  kind: GearKind.Battery,
  name: "Tattu 1300",
  quantity: 2,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  catalogRef: null,
  specs,
});

describe("Gear item", () => {
  it("keeps where each spec came from", () => {
    const item = gearItemSchema.parse(
      battery({
        cells: { source: SpecSource.Catalog, pluginId: CATALOG, value: CELLS },
        chemistry: { source: SpecSource.User, value: "lipo" },
      }),
    );
    expect(item.specs["cells"]).toEqual({ source: SpecSource.Catalog, pluginId: CATALOG, value: CELLS });
    expect(item.specs["chemistry"]).toEqual({ source: SpecSource.User, value: "lipo" });
    expect(specsOf(item)).toEqual({ kind: GearKind.Battery, cells: CELLS, chemistry: "lipo" });
  });

  it("rejects a stored spec that breaks the vocabulary", () => {
    expect(gearItemSchema.safeParse(battery({ chemistry: { source: SpecSource.User, value: "nicd" } })).success).toBe(
      false,
    );
    expect(gearItemSchema.safeParse(battery({ rcLink: { source: SpecSource.User, value: "elrs-2g4" } })).success).toBe(
      false,
    );
  });

  it("cannot store a spec without a source", () => {
    expect(gearItemSchema.safeParse(battery({ cells: CELLS })).success).toBe(false);
    expect(gearItemSchema.safeParse(battery({ cells: { value: CELLS } })).success).toBe(false);
    expect(gearItemSchema.safeParse(battery({ cells: { source: SpecSource.Catalog, value: CELLS } })).success).toBe(
      false,
    );
  });

  it("accepts an item with no specs known yet", () => {
    expect(specsOf(gearItemSchema.parse(battery({})))).toEqual({ kind: GearKind.Battery });
  });
});
