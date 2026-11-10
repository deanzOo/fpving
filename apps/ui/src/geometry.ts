import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Merges geometries into one and frees the parts. Indexed and non-indexed parts can be mixed: the merge is then
 * non-indexed.
 *
 * @returns The merged geometry.
 */
export const merged = (geometries: readonly BufferGeometry[]): BufferGeometry => {
  const mixed = geometries.some(({ index }) => index === null) && geometries.some(({ index }) => index !== null);
  const parts = geometries.map((part) => (mixed && part.index !== null ? part.toNonIndexed() : part));
  const geometry = mergeGeometries(parts);
  for (const part of geometries) {
    part.dispose();
  }
  return geometry;
};
