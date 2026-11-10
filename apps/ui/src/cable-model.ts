import { CatmullRomCurve3, TubeGeometry, Vector3 } from "three";
import type { BufferGeometry } from "three";

const SEGMENTS = 32;
const SIDES = 16;

/**
 * A point in model space, in millimetres.
 *
 * @returns The point.
 */
export const at = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/**
 * Builds a round cable along a smooth curve through the points.
 *
 * @returns The cable's geometry.
 */
export const tube = (points: readonly Vector3[], radius: number): BufferGeometry =>
  new TubeGeometry(new CatmullRomCurve3([...points]), SEGMENTS, radius, SIDES);
