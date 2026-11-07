import { describe, expect, it } from "vitest";
import { ESC_PIECE_GUIDES } from "../src/esc-guide.ts";
import { buildEsc, EscPiece, MOSFETS_PER_MOTOR, MOTORS } from "../src/esc-model.ts";

const PHASES_PER_MOTOR = 3;
const SWITCHES_PER_PHASE = 2;
const SIDE_ON_LIMIT = Math.PI / PHASES_PER_MOTOR / SWITCHES_PER_PHASE;

describe("ESC model", () => {
  const esc = buildEsc();
  const meshesOf = (id: EscPiece) => esc.pieces.find((piece) => piece.id === id)?.meshes ?? [];

  it("builds every piece the guide describes, and no others", () => {
    expect(esc.pieces.map(({ id }) => id)).toEqual(Object.values(EscPiece));
    expect(Object.keys(ESC_PIECE_GUIDES).toSorted()).toEqual(Object.values(EscPiece).toSorted());
  });

  it("drives four motors with a high and a low switch for each of their three phases", () => {
    expect(MOSFETS_PER_MOTOR).toBe(PHASES_PER_MOTOR * SWITCHES_PER_PHASE);
    expect(MOTORS).toBeGreaterThan(PHASES_PER_MOTOR);
  });

  it("has nothing that spins and no phases to light", () => {
    expect(esc.phases).toBe(0);
    expect(esc.pieces.some(({ spins }) => spins)).toBe(false);
  });

  it("is seen from higher up than the motor, since it is flat", () => {
    expect(esc.elevation).toBeGreaterThan(SIDE_ON_LIMIT);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of esc.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });

  it("colours the battery leads by polarity", () => {
    expect(meshesOf(EscPiece.BatteryPads).map(({ finish }) => finish.token)).toEqual(
      expect.arrayContaining(["model-positive", "model-negative"]),
    );
  });
});
