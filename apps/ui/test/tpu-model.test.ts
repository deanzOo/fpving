import { describe, expect, it } from "vitest";
import { TPU_PIECE_GUIDES } from "../src/tpu-guide.ts";
import { buildTpuParts, TpuPiece } from "../src/tpu-model.ts";
import { boxOf } from "./support/model-box.ts";

describe("TPU parts model", () => {
  const tpu = buildTpuParts();
  const ids = Object.values(TpuPiece);

  it("builds every part the guide describes, and no others", () => {
    expect(tpu.pieces.map(({ id }) => id)).toEqual(ids);
    expect(Object.keys(TPU_PIECE_GUIDES).toSorted()).toEqual(ids.toSorted());
  });

  it("prints every part in TPU", () => {
    const tokens = new Set(tpu.pieces.flatMap(({ meshes }) => meshes.map(({ finish }) => finish.token)));
    expect([...tokens]).toEqual(["model-tpu"]);
  });

  it("sets the parts out in list order, each clear of the next", () => {
    const edges = ids.map((id) => boxOf(tpu, id));
    const gaps = edges.slice(1).map((box, index) => box.min.x - (edges[index]?.max.x ?? 0));
    expect(gaps.every((gap) => gap > 0)).toBe(true);
  });

  it("rests every part on the ground, none below it", () => {
    expect(ids.map((id) => boxOf(tpu, id).min.y).every((low) => low >= 0)).toBe(true);
  });

  it("has nothing that spins, comes apart or lights", () => {
    expect(tpu.phases).toBe(0);
    expect(tpu.pieces.every(({ spins, offset }) => !spins && offset === 0)).toBe(true);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of tpu.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
