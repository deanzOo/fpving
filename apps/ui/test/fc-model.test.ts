import { describe, expect, it } from "vitest";
import { FC_PIECE_GUIDES } from "../src/fc-guide.ts";
import { buildFc, FcPiece } from "../src/fc-model.ts";
import { buildMotor } from "../src/motor-model.ts";
import { boxOf } from "./support/model-box.ts";

describe("Flight controller model", () => {
  const fc = buildFc();

  it("builds every piece the guide describes, and no others", () => {
    expect(fc.pieces.map(({ id }) => id)).toEqual(Object.values(FcPiece));
    expect(Object.keys(FC_PIECE_GUIDES).toSorted()).toEqual(Object.values(FcPiece).toSorted());
  });

  it("has nothing that spins and no phases to light", () => {
    expect(fc.phases).toBe(0);
    expect(fc.pieces.some(({ spins }) => spins)).toBe(false);
  });

  it("is seen from higher up than the motor, since it is flat", () => {
    expect(fc.elevation).toBeGreaterThan(buildMotor().elevation);
  });

  it("puts the USB port at the board's edge, so it can be reached in the frame", () => {
    expect(boxOf(fc, FcPiece.UsbPort).min.x).toBeLessThanOrEqual(boxOf(fc, FcPiece.Board).min.x);
  });

  it("keeps every chip on the board", () => {
    const board = boxOf(fc, FcPiece.Board);
    for (const id of [FcPiece.Processor, FcPiece.Gyro, FcPiece.Osd, FcPiece.Flash, FcPiece.Regulators]) {
      const chip = boxOf(fc, id);
      expect(chip.min.x).toBeGreaterThan(board.min.x);
      expect(chip.max.x).toBeLessThan(board.max.x);
      expect(chip.min.z).toBeGreaterThan(board.min.z);
      expect(chip.max.z).toBeLessThan(board.max.z);
    }
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of fc.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
