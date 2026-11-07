import {
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector2,
  Vector3,
} from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the motor, in order from the top of the motor down. */
export const MotorPiece = {
  Nut: "nut",
  Shaft: "shaft",
  Bell: "bell",
  Magnets: "magnets",
  TopBearing: "top-bearing",
  Windings: "windings",
  Stator: "stator",
  Wires: "wires",
  BottomBearing: "bottom-bearing",
  Base: "base",
  Clip: "clip",
} as const;
/** One of the {@link MotorPiece} values. */
export type MotorPiece = (typeof MotorPiece)[keyof typeof MotorPiece];

/** How many teeth the stator has. */
export const STATOR_SLOTS = 12;
/** How many magnets the bell carries. */
export const MAGNET_POLES = 14;
/** How many sets of coils the motor has. */
export const PHASES = 3;

const WHOLE_TURN = Math.PI + Math.PI;
const HALF = 0.5;
const QUARTER_TURN = Math.PI * HALF;
const EVERY_OTHER = 2;
const POLE_PAIRS = MAGNET_POLES * HALF;
const MOUNT_HOLES = 4;
const SIDE_ON = 0.3;

const FINISH = {
  bell: { token: "model-bell", roughness: 0.34, metalness: 0.8 },
  base: { token: "model-base", roughness: 0.42, metalness: 1 },
  steel: { token: "model-steel", roughness: 0.28, metalness: 1 },
  steelDark: { token: "model-steel-dark", roughness: 0.5, metalness: 1 },
  lamination: { token: "model-lamination", roughness: 0.48, metalness: 1 },
  copper: { token: "model-copper", roughness: 0.32, metalness: 1 },
  nylon: { token: "model-nylon", roughness: 0.55, metalness: 0 },
  north: { token: "model-north", roughness: 0.34, metalness: 0.55 },
  south: { token: "model-south", roughness: 0.34, metalness: 0.55 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const PHASE_TOKENS = ["model-phase-a", "model-phase-b", "model-phase-c"] as const;

const OFFSET = {
  nut: 45,
  rotor: 35,
  magnets: 24,
  topBearing: 13.5,
  bottomBearing: -22,
  base: -10,
  clip: -27,
} as const;

interface Point { readonly r: number; readonly y: number }

const lathe = (profile: readonly Point[], segments: number): LatheGeometry =>
  new LatheGeometry(profile.map(({ r, y }) => new Vector2(r, y)), segments);

const hole = (x: number, y: number, radius: number): Path => new Path().absarc(x, y, radius, 0, WHOLE_TURN, true);

const extrudeUp = (shape: Shape, { depth, y, bevel = 0, curve }: {
  readonly depth: number;
  readonly y: number;
  readonly bevel?: number;
  readonly curve: number;
}): ExtrudeGeometry => {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    curveSegments: curve,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
  });
  geometry.rotateX(-Math.PI * HALF);
  geometry.translate(0, y, 0);
  return geometry;
};

const around = <T>(count: number, make: (angle: number, index: number) => T): T[] =>
  Array.from({ length: count }, (_none, index) => make((index / count) * WHOLE_TURN, index));

const merged = (geometries: readonly BufferGeometry[]): BufferGeometry => {
  const geometry = mergeGeometries([...geometries]);
  for (const part of geometries) {
    part.dispose();
  }
  return geometry;
};

const PLATE = {
  outer: 13.4,
  waist: 10.2,
  samples: 160,
  lobeRate: 2,
  lobeSharpness: 2.6,
  mountRadius: 11.3137,
  mountHole: 1.6,
  ventInner: 6.2,
  ventOuter: 8.8,
  ventHalf: 0.34,
  bore: 4.5,
  thickness: 1.3,
  y: 0.1,
  bevel: 0.1,
  curve: 24,
} as const;

const TUBE_PROFILE = [
  { r: 4.5, y: 1.5 },
  { r: 5.45, y: 1.5 },
  { r: 5.45, y: 10.5 },
  { r: 5.2, y: 10.8 },
  { r: 4.5, y: 10.8 },
  { r: 4.5, y: 1.5 },
] as const;
const SEAT_PROFILE = [
  { r: 4.5, y: 0 },
  { r: 6.1, y: 0 },
  { r: 6.1, y: 2.8 },
  { r: 5.45, y: 3 },
  { r: 4.5, y: 3 },
  { r: 4.5, y: 0 },
] as const;
const ROUND = { fine: 128, regular: 96, coarse: 64, small: 48 } as const;

const basePlate = (): BufferGeometry => {
  const plate = new Shape();
  plate.setFromPoints(Array.from({ length: PLATE.samples }, (_none, sample) => {
    const angle = (sample / PLATE.samples) * WHOLE_TURN;
    const lobe = Math.abs(Math.cos((angle - QUARTER_TURN * HALF) * PLATE.lobeRate)) ** PLATE.lobeSharpness;
    const radius = PLATE.waist + (PLATE.outer - PLATE.waist) * lobe;
    return new Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }));
  around(MOUNT_HOLES, (angle) => {
    const mount = angle + QUARTER_TURN * HALF;
    plate.holes.push(hole(Math.cos(mount) * PLATE.mountRadius, Math.sin(mount) * PLATE.mountRadius, PLATE.mountHole));
    const vent = new Path();
    vent.absarc(0, 0, PLATE.ventOuter, angle + PLATE.ventHalf, angle - PLATE.ventHalf, true);
    vent.absarc(0, 0, PLATE.ventInner, angle - PLATE.ventHalf, angle + PLATE.ventHalf, false);
    vent.closePath();
    plate.holes.push(vent);
  });
  plate.holes.push(hole(0, 0, PLATE.bore));
  return extrudeUp(plate, { depth: PLATE.thickness, y: PLATE.y, bevel: PLATE.bevel, curve: PLATE.curve });
};

const base = (): ModelMesh[] => [
  { geometry: basePlate(), finish: FINISH.base },
  { geometry: lathe(TUBE_PROFILE, ROUND.regular), finish: FINISH.base },
  { geometry: lathe(SEAT_PROFILE, ROUND.regular), finish: FINISH.base },
];

const RACE = {
  height: 4,
  outer: 4.5,
  outerInside: 3.75,
  outerGroove: 3.55,
  inner: 2,
  innerOutside: 2.75,
  innerGroove: 2.95,
  lip: 1.2,
  shieldInset: 0.25,
  balls: 8,
  ballRadius: 0.34,
  ballTrack: 3.25,
  ballSides: 14,
  ballRings: 10,
} as const;

const bearing = (bottom: number): ModelMesh[] => {
  const top = bottom + RACE.height;
  const outer = lathe([
    { r: RACE.outerInside, y: bottom },
    { r: RACE.outer, y: bottom },
    { r: RACE.outer, y: top },
    { r: RACE.outerInside, y: top },
    { r: RACE.outerGroove, y: top - RACE.lip },
    { r: RACE.outerGroove, y: bottom + RACE.lip },
    { r: RACE.outerInside, y: bottom },
  ], ROUND.coarse);
  const inner = lathe([
    { r: RACE.inner, y: bottom },
    { r: RACE.innerOutside, y: bottom },
    { r: RACE.innerGroove, y: bottom + RACE.lip },
    { r: RACE.innerGroove, y: top - RACE.lip },
    { r: RACE.innerOutside, y: top },
    { r: RACE.inner, y: top },
    { r: RACE.inner, y: bottom },
  ], ROUND.coarse);
  const shield = lathe([
    { r: RACE.innerOutside, y: top - RACE.shieldInset },
    { r: RACE.outerInside, y: top - RACE.shieldInset },
  ], ROUND.coarse);
  const balls = around(RACE.balls, (angle) =>
    new SphereGeometry(RACE.ballRadius, RACE.ballSides, RACE.ballRings).translate(
      Math.cos(angle) * RACE.ballTrack,
      bottom + RACE.height * HALF,
      Math.sin(angle) * RACE.ballTrack,
    ));
  return [
    { geometry: outer, finish: FINISH.steel },
    { geometry: inner, finish: FINISH.steel },
    { geometry: merged(balls), finish: FINISH.steel },
    { geometry: shield, finish: FINISH.steelDark },
  ];
};

const CORE = {
  bore: 5.45,
  yoke: 7,
  shoeInner: 10,
  shoeOuter: 11,
  shank: 0.95,
  shoeShare: 0.385,
  sheets: 14,
  bottom: 3,
  height: 7,
  gap: 0.05,
  curve: 5,
} as const;

const coreShape = (): Shape => {
  const shape = new Shape();
  const pitch = WHOLE_TURN / STATOR_SLOTS;
  const shoeHalf = pitch * CORE.shoeShare;
  const shankAtYoke = Math.asin(CORE.shank / CORE.yoke);
  const shankAtShoe = Math.asin(CORE.shank / CORE.shoeInner);
  const point = (radius: number, angle: number): readonly [number, number] =>
    [Math.cos(angle) * radius, Math.sin(angle) * radius];
  around(STATOR_SLOTS, (angle, slot) => {
    const start = point(CORE.yoke, angle - shankAtYoke);
    if (slot === 0) {
      shape.moveTo(...start);
    } else {
      shape.lineTo(...start);
    }
    shape.lineTo(...point(CORE.shoeInner, angle - shankAtShoe));
    shape.lineTo(...point(CORE.shoeInner, angle - shoeHalf));
    shape.lineTo(...point(CORE.shoeOuter, angle - shoeHalf));
    shape.absarc(0, 0, CORE.shoeOuter, angle - shoeHalf, angle + shoeHalf, false);
    shape.lineTo(...point(CORE.shoeInner, angle + shoeHalf));
    shape.lineTo(...point(CORE.shoeInner, angle + shankAtShoe));
    shape.lineTo(...point(CORE.yoke, angle + shankAtYoke));
    shape.absarc(0, 0, CORE.yoke, angle + shankAtYoke, angle + pitch - shankAtYoke, false);
  });
  shape.closePath();
  shape.holes.push(hole(0, 0, CORE.bore));
  return shape;
};

const stator = (): ModelMesh[] => {
  const shape = coreShape();
  const thickness = CORE.height / CORE.sheets - CORE.gap;
  const sheets = Array.from({ length: CORE.sheets }, (_none, sheet) =>
    extrudeUp(shape, { depth: thickness, y: CORE.bottom + sheet * (thickness + CORE.gap), curve: CORE.curve }));
  return [{ geometry: merged(sheets), finish: FINISH.lamination }];
};

const COIL = {
  wire: 0.2,
  layers: 2,
  halfWidth: 1.2,
  halfHeight: 3.75,
  layerStep: 0.37,
  inner: 7.35,
  outer: 9.65,
  taper: 0.12,
  turnSpacing: 0.41,
  middle: 6.5,
  cornerShare: 0.3,
  maxCorner: 0.6,
  cornerSteps: 5,
  tension: 0.2,
  tubeSegments: 20,
  tubeSides: 5,
} as const;

const coilTurn = (radial: number, halfWidth: number, halfHeight: number): BufferGeometry => {
  const corner = Math.min(COIL.maxCorner, halfHeight * COIL.cornerShare);
  const arc = (centreZ: number, centreY: number, from: number): Vector3[] =>
    Array.from({ length: COIL.cornerSteps + 1 }, (_none, step) => {
      const angle = from + (step / COIL.cornerSteps) * QUARTER_TURN;
      return new Vector3(
        radial,
        COIL.middle + centreY + Math.sin(angle) * corner,
        centreZ + Math.cos(angle) * corner,
      );
    });
  const insetZ = halfWidth - corner;
  const insetY = halfHeight - corner;
  const points = [
    ...arc(insetZ, insetY, 0),
    ...arc(-insetZ, insetY, QUARTER_TURN),
    ...arc(-insetZ, -insetY, QUARTER_TURN + QUARTER_TURN),
    ...arc(insetZ, -insetY, QUARTER_TURN + QUARTER_TURN + QUARTER_TURN),
  ];
  const path = new CatmullRomCurve3(points, true, "catmullrom", COIL.tension);
  return new TubeGeometry(path, COIL.tubeSegments, COIL.wire, COIL.tubeSides, true);
};

const coil = (angle: number): BufferGeometry => {
  const turns = Array.from({ length: COIL.layers }, (_none, layer) => {
    const inner = COIL.inner + layer * COIL.taper;
    const outer = COIL.outer - layer * COIL.taper;
    const count = Math.round((outer - inner) / COIL.turnSpacing);
    return Array.from({ length: count + 1 }, (_turn, turn) => coilTurn(
      inner + (turn / count) * (outer - inner),
      COIL.halfWidth + layer * COIL.layerStep,
      COIL.halfHeight + layer * COIL.layerStep,
    ));
  }).flat();
  return merged(turns).rotateY(-angle);
};

const windings = (): ModelMesh[] => {
  const coils = around(STATOR_SLOTS, (angle, slot) => ({ phase: slot % PHASES, geometry: coil(angle) }));
  return PHASE_TOKENS.map((token, index) => ({
    geometry: merged(coils.filter(({ phase }) => phase === index).map(({ geometry }) => geometry)),
    finish: FINISH.copper,
    phase: { index, token },
  }));
};

const LEAD = {
  first: -0.42,
  spacing: 0.28,
  curl: 0.02,
  curlFrom: 7,
  insulation: 0.4,
  roughness: 0.55,
  segments: 72,
  sides: 12,
  tip: 0.3,
  tipLength: 2.6,
  tipAt: 31,
  tipY: -1.75,
  tipTurn: 0.48,
} as const;
const LEAD_PATH = [
  { r: 7.7, y: 2.5 },
  { r: 8.1, y: 1.4 },
  { r: 10, y: 0.5 },
  { r: 15, y: -1.4 },
  { r: 21, y: -2.4 },
  { r: 30, y: -1.8 },
] as const;

const wires = (): ModelMesh[] => PHASE_TOKENS.flatMap((token, index) => {
  const angle = LEAD.first + index * LEAD.spacing;
  const at = ({ r, y }: Point): Vector3 => {
    const swept = angle + (r - LEAD.curlFrom) * LEAD.curl;
    return new Vector3(Math.cos(swept) * r, y, Math.sin(swept) * r);
  };
  const path = new CatmullRomCurve3(LEAD_PATH.map(at));
  const end = at({ r: LEAD.tipAt, y: LEAD.tipY });
  const tip = new CylinderGeometry(LEAD.tip, LEAD.tip, LEAD.tipLength, LEAD.sides)
    .rotateZ(QUARTER_TURN)
    .rotateY(-angle - LEAD.tipTurn)
    .translate(end.x, end.y, end.z);
  return [
    {
      geometry: new TubeGeometry(path, LEAD.segments, LEAD.insulation, LEAD.sides),
      finish: { token, roughness: LEAD.roughness, metalness: 0 },
    },
    { geometry: tip, finish: FINISH.steel },
  ];
});

const THREAD = {
  count: 18,
  radius: 2.33,
  tube: 0.16,
  sides: 5,
  segments: 24,
  tilt: 0.035,
  from: 15.1,
  pitch: 0.43,
} as const;
const SHAFT_PROFILE = [
  { r: 0, y: -0.6 },
  { r: 1.75, y: -0.6 },
  { r: 2, y: -0.4 },
  { r: 2, y: -0.3 },
  { r: 1.65, y: -0.3 },
  { r: 1.65, y: 0.25 },
  { r: 2, y: 0.25 },
  { r: 2, y: 14.6 },
  { r: 2.32, y: 14.8 },
  { r: 2.32, y: 22.9 },
  { r: 2.05, y: 23.2 },
  { r: 0, y: 23.2 },
] as const;

const shaft = (): ModelMesh[] => {
  const threads = Array.from({ length: THREAD.count }, (_none, turn) =>
    new TorusGeometry(THREAD.radius, THREAD.tube, THREAD.sides, THREAD.segments)
      .rotateX(QUARTER_TURN + THREAD.tilt)
      .translate(0, THREAD.from + turn * THREAD.pitch, 0));
  return [
    { geometry: lathe(SHAFT_PROFILE, ROUND.small), finish: FINISH.steel },
    { geometry: merged(threads), finish: FINISH.steel },
  ];
};

const SKIRT_PROFILE = [
  { r: 12.5, y: 1.8 },
  { r: 13.35, y: 1.8 },
  { r: 13.55, y: 2 },
  { r: 13.55, y: 3.2 },
  { r: 13.38, y: 3.35 },
  { r: 13.38, y: 3.65 },
  { r: 13.55, y: 3.8 },
  { r: 13.55, y: 8.6 },
  { r: 13.38, y: 8.75 },
  { r: 13.38, y: 9.05 },
  { r: 13.55, y: 9.2 },
  { r: 13.55, y: 11.2 },
  { r: 13.3, y: 12.8 },
  { r: 12.8, y: 13.3 },
  { r: 12.5, y: 13.3 },
  { r: 12.5, y: 1.8 },
] as const;
const HUB_PROFILE = [
  { r: 2, y: 11.5 },
  { r: 4.4, y: 11.5 },
  { r: 4.4, y: 13.5 },
  { r: 3.7, y: 14.1 },
  { r: 3.7, y: 14.8 },
  { r: 3.45, y: 15 },
  { r: 2, y: 15 },
] as const;
const FLUX_RING_PROFILE = [
  { r: 12.32, y: 2.6 },
  { r: 12.5, y: 2.6 },
  { r: 12.5, y: 11.8 },
  { r: 12.32, y: 11.8 },
  { r: 12.32, y: 2.6 },
] as const;
const CAP = {
  radius: 12.8,
  bore: 2,
  vents: 6,
  ventShare: 0.36,
  ventInner: 5,
  ventOuter: 10.9,
  ventNarrow: 0.72,
  thickness: 1.3,
  y: 11.8,
  bevel: 0.08,
  curve: 32,
} as const;

const bellCap = (): BufferGeometry => {
  const cap = new Shape();
  cap.absarc(0, 0, CAP.radius, 0, WHOLE_TURN, false);
  cap.holes.push(hole(0, 0, CAP.bore));
  around(CAP.vents, (angle) => {
    const half = (WHOLE_TURN / CAP.vents) * CAP.ventShare;
    const vent = new Path();
    vent.absarc(0, 0, CAP.ventOuter, angle + half, angle - half, true);
    vent.absarc(0, 0, CAP.ventInner, angle - half * CAP.ventNarrow, angle + half * CAP.ventNarrow, false);
    vent.closePath();
    cap.holes.push(vent);
  });
  return extrudeUp(cap, { depth: CAP.thickness, y: CAP.y, bevel: CAP.bevel, curve: CAP.curve });
};

const bell = (): ModelMesh[] => [
  { geometry: lathe(SKIRT_PROFILE, ROUND.fine), finish: FINISH.bell },
  { geometry: bellCap(), finish: FINISH.bell },
  { geometry: lathe(HUB_PROFILE, ROUND.coarse), finish: FINISH.bell },
  { geometry: lathe(FLUX_RING_PROFILE, ROUND.fine), finish: FINISH.steelDark },
];

const MAGNET = { outer: 12.32, inner: 11.35, share: 0.44, height: 8, y: 2.9, curve: 10 } as const;

const magnets = (): ModelMesh[] => {
  const half = (WHOLE_TURN / MAGNET_POLES) * MAGNET.share;
  const poles = around(MAGNET_POLES, (angle, pole) => {
    const shape = new Shape();
    shape.absarc(0, 0, MAGNET.outer, angle - half, angle + half, false);
    shape.absarc(0, 0, MAGNET.inner, angle + half, angle - half, true);
    shape.closePath();
    const geometry = extrudeUp(shape, { depth: MAGNET.height, y: MAGNET.y, curve: MAGNET.curve });
    return { north: pole % EVERY_OTHER === 0, geometry };
  });
  const of = (north: boolean): BufferGeometry =>
    merged(poles.filter((pole) => pole.north === north).map(({ geometry }) => geometry));
  return [{ geometry: of(true), finish: FINISH.north }, { geometry: of(false), finish: FINISH.south }];
};

const NUT = { radius: 3.9, sides: 6, bore: 2.35, height: 3.1, y: 18.6, bevel: 0.12, curve: 12 } as const;
const COLLAR_PROFILE = [
  { r: 2.35, y: 21.6 },
  { r: 3.3, y: 21.6 },
  { r: 3.3, y: 22.9 },
  { r: 3, y: 23.2 },
  { r: 2.35, y: 23.2 },
  { r: 2.35, y: 21.6 },
] as const;
const INSERT_PROFILE = [
  { r: 2.32, y: 22.3 },
  { r: 2.9, y: 22.3 },
  { r: 2.9, y: 23.3 },
  { r: 2.32, y: 23.3 },
  { r: 2.32, y: 22.3 },
] as const;

const nut = (): ModelMesh[] => {
  const hex = new Shape();
  hex.setFromPoints(around(NUT.sides, (angle) =>
    new Vector2(Math.cos(angle) * NUT.radius, Math.sin(angle) * NUT.radius)));
  hex.holes.push(hole(0, 0, NUT.bore));
  const body = extrudeUp(hex, { depth: NUT.height, y: NUT.y, bevel: NUT.bevel, curve: NUT.curve });
  return [
    { geometry: body, finish: FINISH.steel },
    { geometry: lathe(COLLAR_PROFILE, ROUND.small), finish: FINISH.steel },
    { geometry: lathe(INSERT_PROFILE, ROUND.small), finish: FINISH.nylon },
  ];
};

const CLIP = { outer: 2.75, inner: 1.68, gap: 0.5, height: 0.45, y: -0.25, curve: 36 } as const;

const clip = (): ModelMesh[] => {
  const shape = new Shape();
  shape.absarc(0, 0, CLIP.outer, CLIP.gap, WHOLE_TURN - CLIP.gap, false);
  shape.absarc(0, 0, CLIP.inner, WHOLE_TURN - CLIP.gap, CLIP.gap, true);
  shape.closePath();
  const geometry = extrudeUp(shape, { depth: CLIP.height, y: CLIP.y, curve: CLIP.curve });
  return [{ geometry, finish: FINISH.steelDark }];
};

const BEARING_BOTTOM = { top: 6.6, bottom: 1.5 } as const;

/**
 * Builds a typical 2207 brushless outrunner from its dimensions in millimetres, with 12 stator slots and 14 magnets.
 *
 * @returns The motor's pieces, from the top of the motor down.
 */
export const buildMotor = (): Model<MotorPiece> => {
  const piece = (
    id: MotorPiece,
    offset: number,
    spins: boolean,
    meshes: readonly ModelMesh[],
  ): ModelPiece<MotorPiece> => ({ id, offset, spins, meshes });
  return {
    elevation: SIDE_ON,
    phases: PHASES,
    polePairs: POLE_PAIRS,
    pieces: [
      piece(MotorPiece.Nut, OFFSET.nut, true, nut()),
      piece(MotorPiece.Shaft, OFFSET.rotor, true, shaft()),
      piece(MotorPiece.Bell, OFFSET.rotor, true, bell()),
      piece(MotorPiece.Magnets, OFFSET.magnets, true, magnets()),
      piece(MotorPiece.TopBearing, OFFSET.topBearing, false, bearing(BEARING_BOTTOM.top)),
      piece(MotorPiece.Windings, 0, false, windings()),
      piece(MotorPiece.Stator, 0, false, stator()),
      piece(MotorPiece.Wires, 0, false, wires()),
      piece(MotorPiece.BottomBearing, OFFSET.bottomBearing, false, bearing(BEARING_BOTTOM.bottom)),
      piece(MotorPiece.Base, OFFSET.base, false, base()),
      piece(MotorPiece.Clip, OFFSET.clip, true, clip()),
    ],
  };
};
