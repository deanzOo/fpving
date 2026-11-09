import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FRAME_PIECE_GUIDES } from "../src/frame-guide.ts";
import { buildFrame, FramePiece, WHEELBASE } from "../src/frame-model.ts";

const FIVE_INCH = { least: 180, most: 230 } as const;
const SIDE_ON = { divisor: 6 } as const;
const SIDE_ON_LIMIT = Math.PI / SIDE_ON.divisor;
const DIGITS = 6;
const ROUND_TIP = 0;

describe("Frame model", () => {
  const frame = buildFrame();
  const boxOf = (id: FramePiece): Box3 => {
    const box = new Box3();
    for (const { geometry } of frame.pieces.find((piece) => piece.id === id)?.meshes ?? []) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox ?? new Box3());
    }
    return box;
  };

  it("builds every piece the guide describes, and no others", () => {
    expect(frame.pieces.map(({ id }) => id)).toEqual(Object.values(FramePiece));
    expect(Object.keys(FRAME_PIECE_GUIDES).toSorted()).toEqual(Object.values(FramePiece).toSorted());
  });

  it("has nothing that spins and no phases to light", () => {
    expect(frame.phases).toBe(0);
    expect(frame.pieces.some(({ spins }) => spins)).toBe(false);
  });

  it("is seen from higher up than the motor, since it is flat", () => {
    expect(frame.elevation).toBeGreaterThan(SIDE_ON_LIMIT);
  });

  it("has a 5 inch frame's wheelbase", () => {
    expect(WHEELBASE).toBeGreaterThanOrEqual(FIVE_INCH.least);
    expect(WHEELBASE).toBeLessThanOrEqual(FIVE_INCH.most);
  });

  it("is a true X: its arms reach as far sideways as forwards, on every side", () => {
    const { min, max } = boxOf(FramePiece.Arms);
    expect(max.x).toBeCloseTo(-min.x, DIGITS);
    expect(max.z).toBeCloseTo(-min.z, DIGITS);
    expect(max.x).toBeCloseTo(max.z, ROUND_TIP);
  });

  it("puts the camera plates at the front, the end that faces the viewer", () => {
    expect(boxOf(FramePiece.CameraPlates).min.z).toBeGreaterThan(boxOf(FramePiece.TopPlate).getCenter(new Vector3()).z);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of frame.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
