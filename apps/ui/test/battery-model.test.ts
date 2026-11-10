import { describe, expect, it } from "vitest";
import { BATTERY_PIECE_GUIDES } from "../src/battery-guide.ts";
import { BatteryPiece, buildBattery, CELLS } from "../src/battery-model.ts";
import { boxOf } from "./support/model-box.ts";

const SERIES_6S = 6;

describe("Battery model", () => {
  const battery = buildBattery();
  const meshesOf = (id: BatteryPiece) => battery.pieces.find((piece) => piece.id === id)?.meshes ?? [];

  it("builds every piece the guide describes, and no others", () => {
    expect(battery.pieces.map(({ id }) => id)).toEqual(Object.values(BatteryPiece));
    expect(Object.keys(BATTERY_PIECE_GUIDES).toSorted()).toEqual(Object.values(BatteryPiece).toSorted());
  });

  it("stacks one cell for each S of a 6S pack", () => {
    expect(CELLS).toBe(SERIES_6S);
    expect(meshesOf(BatteryPiece.Cells)).toHaveLength(CELLS);
  });

  it("gives the balance lead one wire more than the pack has cells", () => {
    const wires = meshesOf(BatteryPiece.BalanceLead).filter(({ finish }) => finish.token === "model-wire");
    expect(wires).toHaveLength(CELLS + 1);
  });

  it("colours the main leads by polarity", () => {
    expect(meshesOf(BatteryPiece.Leads).map(({ finish }) => finish.token).toSorted())
      .toEqual(["model-negative", "model-positive"]);
  });

  it("wraps the cells, so the wrap covers them on every side but the ends", () => {
    const wrap = boxOf(battery, BatteryPiece.Wrap);
    const cells = boxOf(battery, BatteryPiece.Cells);
    expect(wrap.min.y).toBeLessThan(cells.min.y);
    expect(wrap.max.y).toBeGreaterThan(cells.max.y);
    expect(wrap.min.z).toBeLessThan(cells.min.z);
    expect(wrap.max.z).toBeGreaterThan(cells.max.z);
  });

  it("brings the XT60 and balance lead out of the same end", () => {
    const end = boxOf(battery, BatteryPiece.Cells).max.x;
    expect(boxOf(battery, BatteryPiece.Xt60).min.x).toBeGreaterThan(end);
    expect(boxOf(battery, BatteryPiece.BalanceLead).max.x).toBeGreaterThan(end);
  });

  it("has nothing that spins and no phases to light", () => {
    expect(battery.phases).toBe(0);
    expect(battery.pieces.some(({ spins }) => spins)).toBe(false);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of battery.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
