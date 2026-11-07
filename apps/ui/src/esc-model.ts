import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the 4-in-1 ESC, in the order the atlas lists them. */
export const EscPiece = {
  Board: "board",
  Mosfets: "mosfets",
  GateDrivers: "gate-drivers",
  Processors: "processors",
  CurrentSensor: "current-sensor",
  FcConnector: "fc-connector",
  MotorPads: "motor-pads",
  BatteryPads: "battery-pads",
  Capacitor: "capacitor",
  Grommets: "grommets",
} as const;
/** One of the {@link EscPiece} values. */
export type EscPiece = (typeof EscPiece)[keyof typeof EscPiece];

/** How many motors the board drives. */
export const MOTORS = 4;
/** How many power switches each motor has: a high and a low one for each of its three phases. */
export const MOSFETS_PER_MOTOR = 6;

const WHOLE_TURN = Math.PI + Math.PI;
const HALF = 0.5;
const QUARTER_TURN = Math.PI * HALF;
const FROM_ABOVE = 0.78;
const SIDES = [-1, 1] as const;
const QUADRANTS = SIDES.flatMap((x) => SIDES.map((z) => ({ x, z })));

const FINISH = {
  pcb: { token: "model-pcb", roughness: 0.55, metalness: 0.1 },
  gold: { token: "model-gold", roughness: 0.3, metalness: 1 },
  chip: { token: "model-chip", roughness: 0.6, metalness: 0.1 },
  steel: { token: "model-steel", roughness: 0.3, metalness: 1 },
  plastic: { token: "model-nylon", roughness: 0.55, metalness: 0 },
  grommet: { token: "model-grommet", roughness: 0.8, metalness: 0 },
  sleeve: { token: "model-capacitor", roughness: 0.45, metalness: 0.2 },
  positive: { token: "model-positive", roughness: 0.55, metalness: 0 },
  negative: { token: "model-negative", roughness: 0.55, metalness: 0 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const OFFSET = {
  mosfets: 7,
  drivers: 11,
  processors: 15,
  sensor: 9,
  connector: 12,
  capacitor: 20,
  grommets: -8,
} as const;

const BOARD = { side: 40, corner: 2.5, thickness: 1.6, hole: 1.6, holeAt: 15.25, curve: 12 } as const;
const TOP = BOARD.thickness;

interface Block {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

const block = ({ x, z, width, depth, height }: Block, base: number = TOP): BufferGeometry =>
  new BoxGeometry(width, height, depth).translate(x, base + height * HALF, z);

const merged = (geometries: readonly BufferGeometry[]): BufferGeometry => {
  const geometry = mergeGeometries([...geometries]);
  for (const part of geometries) {
    part.dispose();
  }
  return geometry;
};

const board = (): ModelMesh[] => {
  const half = BOARD.side * HALF;
  const inner = half - BOARD.corner;
  const shape = new Shape();
  shape.moveTo(-inner, -half);
  shape.lineTo(inner, -half);
  shape.absarc(inner, -inner, BOARD.corner, -QUARTER_TURN, 0, false);
  shape.lineTo(half, inner);
  shape.absarc(inner, inner, BOARD.corner, 0, QUARTER_TURN, false);
  shape.lineTo(-inner, half);
  shape.absarc(-inner, inner, BOARD.corner, QUARTER_TURN, Math.PI, false);
  shape.lineTo(-half, -inner);
  shape.absarc(-inner, -inner, BOARD.corner, Math.PI, Math.PI + QUARTER_TURN, false);
  for (const { x, z } of QUADRANTS) {
    shape.holes.push(new Path().absarc(x * BOARD.holeAt, z * BOARD.holeAt, BOARD.hole, 0, WHOLE_TURN, true));
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth: BOARD.thickness,
    curveSegments: BOARD.curve,
    bevelEnabled: false,
  });
  geometry.rotateX(QUARTER_TURN);
  geometry.translate(0, BOARD.thickness, 0);
  return [{ geometry, finish: FINISH.pcb }];
};

interface Steps { readonly first: number; readonly step: number; readonly count: number }

const positions = ({ first, step, count }: Steps): number[] =>
  Array.from({ length: count }, (_none, index) => first + index * step);

const FET = {
  columns: { first: 4, step: 5.2, count: 3 },
  rows: { first: 3.2, step: 5.2, count: 2 },
  width: 4.4,
  depth: 4.8,
  height: 1,
  tab: 0.25,
} as const;

const mosfets = (): ModelMesh[] => {
  const at = QUADRANTS.flatMap(({ x, z }) => positions(FET.columns).flatMap((column) =>
    positions(FET.rows).map((row) => ({ x: x * column, z: z * row }))));
  const bodies = at.map((spot) => block({ ...spot, width: FET.width, depth: FET.depth, height: FET.height }));
  const tabs = at.map((spot) =>
    block({ ...spot, width: FET.width, depth: FET.depth + FET.tab + FET.tab, height: FET.tab }));
  return [{ geometry: merged(bodies), finish: FINISH.chip }, { geometry: merged(tabs), finish: FINISH.steel }];
};

const DRIVER = { x: 4.5, z: 13.5, side: 4, height: 0.8 } as const;
const PROCESSOR = { x: 9, z: 14, side: 3, height: 0.8 } as const;

const chips = ({ x, z, side, height }: { x: number; z: number; side: number; height: number }): ModelMesh[] => [{
  geometry: merged(QUADRANTS.map((quadrant) =>
    block({ x: quadrant.x * x, z: quadrant.z * z, width: side, depth: side, height }))),
  finish: FINISH.chip,
}];

const SENSOR = { x: 0, z: 15.5, width: 2, depth: 5, height: 0.6, cap: 0.8 } as const;

const currentSensor = (): ModelMesh[] => {
  const ends = SIDES.map((side) => block({
    x: SENSOR.x,
    z: SENSOR.z + side * (SENSOR.depth - SENSOR.cap) * HALF,
    width: SENSOR.width,
    depth: SENSOR.cap,
    height: SENSOR.height,
  }));
  return [
    { geometry: block({ ...SENSOR, depth: SENSOR.depth - SENSOR.cap - SENSOR.cap }), finish: FINISH.chip },
    { geometry: merged(ends), finish: FINISH.steel },
  ];
};

const CONNECTOR = { z: -17, width: 9.6, depth: 3.6, height: 2.6, pins: 8, pitch: 1, pin: 0.3, pinHeight: 1.6 } as const;

const fcConnector = (): ModelMesh[] => {
  const pins = Array.from({ length: CONNECTOR.pins }, (_none, pin) => block({
    x: (pin - (CONNECTOR.pins - 1) * HALF) * CONNECTOR.pitch,
    z: CONNECTOR.z,
    width: CONNECTOR.pin,
    depth: CONNECTOR.pin,
    height: CONNECTOR.pinHeight,
  }, TOP + CONNECTOR.height * HALF));
  const housing = block({
    x: 0,
    z: CONNECTOR.z,
    width: CONNECTOR.width,
    depth: CONNECTOR.depth,
    height: CONNECTOR.height,
  });
  return [
    { geometry: housing, finish: FINISH.plastic },
    { geometry: merged(pins), finish: FINISH.gold },
  ];
};

const PAD = { x: 18.4, rows: { first: 3, step: 3.4, count: 3 }, width: 2.6, depth: 2.6, height: 0.08 } as const;

const motorPads = (): ModelMesh[] => [{
  geometry: merged(QUADRANTS.flatMap(({ x, z }) => positions(PAD.rows).map((row) =>
    block({ x: x * PAD.x, z: z * row, width: PAD.width, depth: PAD.depth, height: PAD.height })))),
  finish: FINISH.gold,
}];

const POWER = { x: 4.2, z: 17.6, width: 5, depth: 3.4, height: 0.1 } as const;
const LEAD = { radius: 1.2, segments: 48, sides: 12, rise: 1.4, out: 8, far: 32, spread: 2.2, drop: -3 } as const;

const batteryPads = (): ModelMesh[] => {
  const lead = (side: number): BufferGeometry => {
    const at = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
    const x = side * POWER.x;
    const path = new CatmullRomCurve3([
      at(x, TOP + LEAD.radius, POWER.z - POWER.depth * HALF),
      at(x, TOP + LEAD.rise, POWER.z + POWER.depth * HALF),
      at(x + side * LEAD.spread, TOP + LEAD.rise, POWER.z + LEAD.out),
      at(x + side * LEAD.spread * LEAD.spread, LEAD.drop, POWER.z + LEAD.far),
    ]);
    return new TubeGeometry(path, LEAD.segments, LEAD.radius, LEAD.sides);
  };
  const pads = SIDES.map((side) =>
    block({ x: side * POWER.x, z: POWER.z, width: POWER.width, depth: POWER.depth, height: POWER.height }));
  return [
    { geometry: merged(pads), finish: FINISH.gold },
    { geometry: lead(1), finish: FINISH.positive },
    { geometry: lead(-1), finish: FINISH.negative },
  ];
};

const CAP = { radius: 4, length: 14, z: 25, y: 4.6, sides: 32, lip: 0.4, leg: 0.3, legLength: 7, legX: 3 } as const;

const capacitor = (): ModelMesh[] => {
  const can = new CylinderGeometry(CAP.radius, CAP.radius, CAP.length, CAP.sides).rotateZ(QUARTER_TURN)
    .translate(0, CAP.y, CAP.z);
  const ends = SIDES.map((side) =>
    new CylinderGeometry(CAP.radius - CAP.lip, CAP.radius - CAP.lip, CAP.lip, CAP.sides).rotateZ(QUARTER_TURN)
      .translate(side * (CAP.length + CAP.lip) * HALF, CAP.y, CAP.z));
  const legs = SIDES.map((side) => new CylinderGeometry(CAP.leg, CAP.leg, CAP.legLength, CAP.sides)
    .rotateX(QUARTER_TURN)
    .translate(side * CAP.legX, CAP.y - CAP.radius * HALF, CAP.z - CAP.radius - CAP.legLength * HALF));
  return [
    { geometry: can, finish: FINISH.sleeve },
    { geometry: merged(ends), finish: FINISH.steel },
    { geometry: merged(legs), finish: FINISH.steel },
  ];
};

const GROMMET = { radius: 2.4, tube: 1, radial: 12, tubular: 32 } as const;

const grommets = (): ModelMesh[] => [{
  geometry: merged(QUADRANTS.map(({ x, z }) =>
    new TorusGeometry(GROMMET.radius, GROMMET.tube, GROMMET.radial, GROMMET.tubular)
      .rotateX(QUARTER_TURN)
      .translate(x * BOARD.holeAt, BOARD.thickness * HALF, z * BOARD.holeAt))),
  finish: FINISH.grommet,
}];

/**
 * Builds a typical 30.5×30.5 mm 4-in-1 ESC for a 5 inch quad, from its dimensions in millimetres: six MOSFETs, a gate
 * driver and a processor for each motor, with the capacitor and battery leads at the back.
 *
 * @returns The ESC's pieces, in the order the atlas lists them.
 */
export const buildEsc = (): Model<EscPiece> => {
  const piece = (id: EscPiece, offset: number, meshes: readonly ModelMesh[]): ModelPiece<EscPiece> =>
    ({ id, offset, spins: false, meshes });
  return {
    elevation: FROM_ABOVE,
    phases: 0,
    polePairs: 0,
    pieces: [
      piece(EscPiece.Board, 0, board()),
      piece(EscPiece.Mosfets, OFFSET.mosfets, mosfets()),
      piece(EscPiece.GateDrivers, OFFSET.drivers, chips(DRIVER)),
      piece(EscPiece.Processors, OFFSET.processors, chips(PROCESSOR)),
      piece(EscPiece.CurrentSensor, OFFSET.sensor, currentSensor()),
      piece(EscPiece.FcConnector, OFFSET.connector, fcConnector()),
      piece(EscPiece.MotorPads, 0, motorPads()),
      piece(EscPiece.BatteryPads, 0, batteryPads()),
      piece(EscPiece.Capacitor, OFFSET.capacitor, capacitor()),
      piece(EscPiece.Grommets, OFFSET.grommets, grommets()),
    ],
  };
};
