import { CylinderGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2 } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The fasteners in the bolts set, in the order the atlas lists them, left to right. */
export const BoltPiece = {
  MotorScrew: "motor-screw",
  FrameScrew: "frame-screw",
  StackScrew: "stack-screw",
  StackNut: "stack-nut",
  Grommet: "grommet",
  PropNut: "prop-nut",
} as const;
/** One of the {@link BoltPiece} values. */
export type BoltPiece = (typeof BoltPiece)[keyof typeof BoltPiece];

const WHOLE_TURN = Math.PI + Math.PI;
const HALF = 0.5;
const HEX = 6;
const ROUND = 32;
const LOW_VIEW = 0.35;
const SPACING = 14;

const FINISH = {
  steel: { token: "model-steel", roughness: 0.3, metalness: 1 },
  anodised: { token: "model-bell", roughness: 0.35, metalness: 1 },
  nylon: { token: "model-nylon", roughness: 0.55, metalness: 0 },
  rubber: { token: "model-grommet", roughness: 0.85, metalness: 0 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const M3 = {
  shank: 1.5, socketHead: 2.75, socketHeight: 3, socket: 1.45, buttonHead: 2.85, buttonHeight: 1.65,
} as const;
const LENGTH = { motor: 8, arm: 12, stack: 30 } as const;
const NUT = { acrossCorners: 3.2, height: 2.4, hole: 1.5 } as const;
const GROMMET = { flange: 3.4, waist: 2.3, bore: 1.5, height: 4.5, lip: 1.2 } as const;
const PROP_NUT = { flange: 5, flangeHeight: 1, acrossCorners: 4.6, height: 4, insert: 3.3, insertHeight: 1.5 } as const;
const M5_BORE = 2.5;

const merged = (geometries: readonly BufferGeometry[]): BufferGeometry => {
  const geometry = mergeGeometries(geometries.map((part) => (part.index === null ? part : part.toNonIndexed())));
  for (const part of geometries) {
    part.dispose();
  }
  return geometry;
};

const hexagon = (radius: number): Shape => {
  const corners = Array.from({ length: HEX }, (_none, index) => (index / HEX) * WHOLE_TURN)
    .map((angle) => new Vector2(radius * Math.cos(angle), radius * Math.sin(angle)));
  return new Shape(corners);
};

const withHole = (shape: Shape, hole: Path): Shape => {
  shape.holes.push(hole);
  return shape;
};

const circle = (radius: number): Path => new Path().absarc(0, 0, radius, 0, WHOLE_TURN, true);

const disc = (radius: number): Shape => new Shape().absarc(0, 0, radius, 0, WHOLE_TURN, false);

const extrudedUp = (shape: Shape, depth: number, base: number): BufferGeometry =>
  new ExtrudeGeometry(shape, { depth, curveSegments: ROUND, bevelEnabled: false })
    .rotateX(-Math.PI * HALF)
    .translate(0, base, 0);

const rod = (radius: number, height: number, base: number, sides = ROUND): BufferGeometry =>
  new CylinderGeometry(radius, radius, height, sides).translate(0, base + height * HALF, 0);

const socketScrew = (length: number): BufferGeometry => {
  const head = withHole(disc(M3.socketHead), hexagon(M3.socket));
  return merged([
    rod(M3.shank, length + M3.socketHeight * HALF, 0),
    extrudedUp(head, M3.socketHeight, length),
  ]);
};

const buttonScrew = (length: number): BufferGeometry => {
  const steps = 8;
  const dome = Array.from({ length: steps + 1 }, (_none, index) => {
    const angle = (index / steps) * Math.PI * HALF;
    return new Vector2(M3.buttonHead * Math.cos(angle), length + M3.buttonHeight * Math.sin(angle));
  });
  return merged([
    rod(M3.shank, length, 0),
    new LatheGeometry([new Vector2(0, length), ...dome], ROUND),
  ]);
};

const nylonNut = (): BufferGeometry =>
  extrudedUp(withHole(hexagon(NUT.acrossCorners), circle(NUT.hole)), NUT.height, 0);

const grommet = (): BufferGeometry => {
  const { flange, waist, bore, height, lip } = GROMMET;
  const outline = [
    [bore, 0], [flange, 0], [flange, lip], [waist, lip], [waist, height - lip], [flange, height - lip],
    [flange, height], [bore, height], [bore, 0],
  ] as const;
  return new LatheGeometry(outline.map(([r, y]) => new Vector2(r, y)), ROUND);
};

const propNut = (): ModelMesh[] => {
  const { flange, flangeHeight, acrossCorners, height, insert, insertHeight } = PROP_NUT;
  const metal = merged([
    extrudedUp(withHole(disc(flange), circle(M5_BORE)), flangeHeight, 0),
    extrudedUp(withHole(hexagon(acrossCorners), circle(M5_BORE)), height, flangeHeight),
  ]);
  const ring = extrudedUp(withHole(disc(insert), circle(M5_BORE)), insertHeight,
    flangeHeight + height);
  return [{ geometry: metal, finish: FINISH.anodised }, { geometry: ring, finish: FINISH.nylon }];
};

const MESHES: Readonly<Record<BoltPiece, () => ModelMesh[]>> = {
  [BoltPiece.MotorScrew]: () => [{ geometry: socketScrew(LENGTH.motor), finish: FINISH.steel }],
  [BoltPiece.FrameScrew]: () => [{ geometry: buttonScrew(LENGTH.arm), finish: FINISH.steel }],
  [BoltPiece.StackScrew]: () => [{ geometry: socketScrew(LENGTH.stack), finish: FINISH.steel }],
  [BoltPiece.StackNut]: () => [{ geometry: nylonNut(), finish: FINISH.nylon }],
  [BoltPiece.Grommet]: () => [{ geometry: grommet(), finish: FINISH.rubber }],
  [BoltPiece.PropNut]: propNut,
};

/**
 * Builds a row of the fasteners a 5 inch quad is put together with, from their sizes in millimetres, standing side
 * by side so they can be compared.
 *
 * @returns The fasteners, left to right in the order the atlas lists them.
 */
export const buildBolts = (): Model<BoltPiece> => {
  const ids = Object.values(BoltPiece);
  const middle = (ids.length - 1) * HALF;
  const pieces = ids.map((id, index): ModelPiece<BoltPiece> => ({
    id,
    offset: 0,
    spins: false,
    meshes: MESHES[id]().map((mesh) => ({
      ...mesh,
      geometry: mesh.geometry.translate((index - middle) * SPACING, 0, 0),
    })),
  }));
  return { elevation: LOW_VIEW, phases: 0, polePairs: 0, pieces };
};
