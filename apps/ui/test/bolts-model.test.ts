import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { BOLT_PIECE_GUIDES } from "../src/bolts-guide.ts";
import { BoltPiece, buildBolts } from "../src/bolts-model.ts";

describe("Bolts model", () => {
  const bolts = buildBolts();
  const boxOf = (id: BoltPiece): Box3 => {
    const box = new Box3();
    for (const { geometry } of bolts.pieces.find((piece) => piece.id === id)?.meshes ?? []) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox ?? new Box3());
    }
    return box;
  };

  it("builds every fastener the guide describes, and no others", () => {
    expect(bolts.pieces.map(({ id }) => id)).toEqual(Object.values(BoltPiece));
    expect(Object.keys(BOLT_PIECE_GUIDES).toSorted()).toEqual(Object.values(BoltPiece).toSorted());
  });

  it("has nothing that spins, comes apart or lights", () => {
    expect(bolts.phases).toBe(0);
    expect(bolts.pieces.some(({ spins }) => spins)).toBe(false);
    expect(bolts.pieces.every(({ offset }) => offset === 0)).toBe(true);
  });

  it("lays the fasteners out left to right in list order, none touching the next", () => {
    const boxes = Object.values(BoltPiece).map(boxOf);
    boxes.slice(1).forEach((box, index) => {
      expect(box.min.x).toBeGreaterThan(boxes[index]?.max.x ?? Infinity);
    });
  });

  it("stands them all on the same ground", () => {
    for (const id of Object.values(BoltPiece)) {
      expect(boxOf(id).min.y).toBeCloseTo(0);
    }
  });

  it("makes the motor screw shorter than the frame screw, and both shorter than the stack screw", () => {
    const height = (id: BoltPiece) => boxOf(id).max.y;
    expect(height(BoltPiece.MotorScrew)).toBeLessThan(height(BoltPiece.FrameScrew));
    expect(height(BoltPiece.FrameScrew)).toBeLessThan(height(BoltPiece.StackScrew));
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of bolts.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
