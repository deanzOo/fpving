import { Box3 } from "three";
import type { Model } from "../../src/ui/model-stage.ts";

export const boxOf = <Id extends string>(model: Model<Id>, id: Id): Box3 => {
  const box = new Box3();
  for (const { geometry } of model.pieces.find((piece) => piece.id === id)?.meshes ?? []) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox ?? new Box3());
  }
  return box;
};
