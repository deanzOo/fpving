import { BoxGeometry, ExtrudeGeometry, Path, Shape, TorusGeometry } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ModelFinish, ModelMesh } from "./ui/model-stage.ts";

const WHOLE_TURN = Math.PI + Math.PI;
/** Half of a length. */
export const HALF = 0.5;
/** A quarter turn, in radians. */
export const QUARTER_TURN = Math.PI * HALF;
/** How far above a flat board the camera looks down from. */
export const FROM_ABOVE = 0.78;
/** Either side of the board's centre line. */
export const SIDES = [-1, 1] as const;
/** The four corners of a board, as signs. */
export const QUADRANTS = SIDES.flatMap((x) => SIDES.map((z) => ({ x, z })));

/** The finishes shared by circuit boards. */
export const PCB_FINISH = {
  pcb: { token: "model-pcb", roughness: 0.55, metalness: 0.1 },
  gold: { token: "model-gold", roughness: 0.3, metalness: 1 },
  chip: { token: "model-chip", roughness: 0.6, metalness: 0.1 },
  steel: { token: "model-steel", roughness: 0.3, metalness: 1 },
  plastic: { token: "model-nylon", roughness: 0.55, metalness: 0 },
  grommet: { token: "model-grommet", roughness: 0.8, metalness: 0 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const PCB = { corner: 2.5, thickness: 1.6, hole: 1.6, holeAt: 15.25, curve: 12 } as const;
/** The height of a board's top face. */
export const TOP = PCB.thickness;

/** A box sitting on a board, from its centre and size. */
export interface Block {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/**
 * Builds a box standing on a surface.
 *
 * @returns The box's geometry.
 */
export const block = ({ x, z, width, depth, height }: Block, base: number = TOP): BufferGeometry =>
  new BoxGeometry(width, height, depth).translate(x, base + height * HALF, z);

/**
 * Merges geometries into one and frees the parts.
 *
 * @returns The merged geometry.
 */
export const merged = (geometries: readonly BufferGeometry[]): BufferGeometry => {
  const geometry = mergeGeometries([...geometries]);
  for (const part of geometries) {
    part.dispose();
  }
  return geometry;
};

/** Evenly spaced positions along one axis. */
export interface Steps { readonly first: number; readonly step: number; readonly count: number }

/**
 * Lists evenly spaced positions.
 *
 * @returns Each position in turn.
 */
export const positions = ({ first, step, count }: Steps): number[] =>
  Array.from({ length: count }, (_none, index) => first + index * step);

/**
 * Builds a square board with rounded corners and a mounting hole in each corner, 30.5×30.5 mm apart by default.
 *
 * @returns The board's mesh.
 */
export const board = (side: number, holeAt: number = PCB.holeAt): ModelMesh[] => {
  const half = side * HALF;
  const inner = half - PCB.corner;
  const shape = new Shape();
  shape.moveTo(-inner, -half);
  shape.lineTo(inner, -half);
  shape.absarc(inner, -inner, PCB.corner, -QUARTER_TURN, 0, false);
  shape.lineTo(half, inner);
  shape.absarc(inner, inner, PCB.corner, 0, QUARTER_TURN, false);
  shape.lineTo(-inner, half);
  shape.absarc(-inner, inner, PCB.corner, QUARTER_TURN, Math.PI, false);
  shape.lineTo(-half, -inner);
  shape.absarc(-inner, -inner, PCB.corner, Math.PI, Math.PI + QUARTER_TURN, false);
  for (const { x, z } of QUADRANTS) {
    shape.holes.push(new Path().absarc(x * holeAt, z * holeAt, PCB.hole, 0, WHOLE_TURN, true));
  }
  const geometry = new ExtrudeGeometry(shape, { depth: PCB.thickness, curveSegments: PCB.curve, bevelEnabled: false });
  geometry.rotateX(QUARTER_TURN);
  geometry.translate(0, PCB.thickness, 0);
  return [{ geometry, finish: PCB_FINISH.pcb }];
};

const CONNECTOR = { width: 9.6, depth: 3.6, height: 2.6, pins: 8, pitch: 1, pin: 0.3, pinHeight: 1.6 } as const;

/**
 * Builds the 8 pin socket for the cable between a flight controller and its ESC.
 *
 * @returns The housing and pin meshes.
 */
export const stackConnector = (z: number): ModelMesh[] => {
  const pins = Array.from({ length: CONNECTOR.pins }, (_none, pin) => block({
    x: (pin - (CONNECTOR.pins - 1) * HALF) * CONNECTOR.pitch,
    z,
    width: CONNECTOR.pin,
    depth: CONNECTOR.pin,
    height: CONNECTOR.pinHeight,
  }, TOP + CONNECTOR.height * HALF));
  const housing = block({ x: 0, z, width: CONNECTOR.width, depth: CONNECTOR.depth, height: CONNECTOR.height });
  return [
    { geometry: housing, finish: PCB_FINISH.plastic },
    { geometry: merged(pins), finish: PCB_FINISH.gold },
  ];
};

const GROMMET = { radius: 2.4, tube: 1, radial: 12, tubular: 32 } as const;

/**
 * Builds a rubber grommet in each mounting hole.
 *
 * @returns The grommets' mesh.
 */
export const grommets = (): ModelMesh[] => [{
  geometry: merged(QUADRANTS.map(({ x, z }) =>
    new TorusGeometry(GROMMET.radius, GROMMET.tube, GROMMET.radial, GROMMET.tubular)
      .rotateX(QUARTER_TURN)
      .translate(x * PCB.holeAt, PCB.thickness * HALF, z * PCB.holeAt))),
  finish: PCB_FINISH.grommet,
}];
