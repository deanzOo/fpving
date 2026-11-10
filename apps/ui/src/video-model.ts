import { CatmullRomCurve3, CylinderGeometry, TubeGeometry, Vector3 } from "three";
import type { BufferGeometry } from "three";
import { block, board, HALF, merged, PCB_FINISH, positions, QUARTER_TURN, SIDES, TOP } from "./pcb-model.ts";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the analog video system, in the order the atlas lists them. */
export const AnalogPiece = {
  Camera: "camera",
  Lens: "lens",
  Vtx: "vtx",
  Button: "button",
  Pigtail: "pigtail",
  Antenna: "antenna",
  Wires: "wires",
} as const;
/** One of the {@link AnalogPiece} values. */
export type AnalogPiece = (typeof AnalogPiece)[keyof typeof AnalogPiece];

/** The pieces of the digital video system, in the order the atlas lists them. */
export const DigitalPiece = {
  Camera: "camera",
  CameraCable: "camera-cable",
  AirUnit: "air-unit",
  Heatsink: "heatsink",
  Antennas: "antennas",
  FcCable: "fc-cable",
} as const;
/** One of the {@link DigitalPiece} values. */
export type DigitalPiece = (typeof DigitalPiece)[keyof typeof DigitalPiece];

const ROUND = 32;
const VIEW = 0.5;

const FINISH = {
  ...PCB_FINISH,
  body: { token: "model-base", roughness: 0.5, metalness: 0.4 },
  glass: { token: "model-lens", roughness: 0.1, metalness: 0.6 },
  cover: { token: "model-antenna", roughness: 0.6, metalness: 0 },
  wire: { token: "model-wire", roughness: 0.7, metalness: 0 },
  shield: { token: "model-steel-dark", roughness: 0.35, metalness: 1 },
  casing: { token: "model-bell", roughness: 0.4, metalness: 0.8 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const at = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const tube = (points: readonly Vector3[], radius: number): BufferGeometry =>
  new TubeGeometry(new CatmullRomCurve3([...points]), ROUND, radius, ROUND * HALF);

const alongZ = (radius: number, length: number, x: number, y: number, z: number): BufferGeometry =>
  new CylinderGeometry(radius, radius, length, ROUND).rotateX(QUARTER_TURN).translate(x, y, z);

const alongX = (radius: number, length: number, x: number, y: number, z: number): BufferGeometry =>
  new CylinderGeometry(radius, radius, length, ROUND).rotateZ(QUARTER_TURN).translate(x, y, z);

const upright = (radius: number, from: number, to: number, x: number, z: number): BufferGeometry =>
  new CylinderGeometry(radius, radius, to - from, ROUND).translate(x, (from + to) * HALF, z);

const CAMERA = { x: -28, side: 19, depth: 16 } as const;
const LENS = { barrel: 6, length: 6, glass: 4.4, pane: 0.4 } as const;
const MIDDLE = CAMERA.side * HALF;
const FRONT = CAMERA.depth * HALF;
const BACK = -FRONT;

const camera = (): ModelMesh[] => [{
  geometry: block({ x: CAMERA.x, z: 0, width: CAMERA.side, depth: CAMERA.depth, height: CAMERA.side }, 0),
  finish: FINISH.body,
}];

const lens = (): ModelMesh[] => [
  { geometry: alongZ(LENS.barrel, LENS.length, CAMERA.x, MIDDLE, FRONT + LENS.length * HALF), finish: FINISH.chip },
  {
    geometry: alongZ(LENS.glass, LENS.pane, CAMERA.x, MIDDLE, FRONT + LENS.length + LENS.pane * HALF),
    finish: FINISH.glass,
  },
];

const PLUG = { width: 4, depth: 3, height: 2 } as const;

const lead = (path: readonly Vector3[], end: Vector3, radius: number): ModelMesh[] => [
  { geometry: tube([...path, end], radius), finish: FINISH.wire },
  { geometry: block({ x: end.x, z: end.z, ...PLUG }, end.y - PLUG.height * HALF), finish: FINISH.plastic },
];

const VTX = { x: 4, side: 27, holeAt: 10, shield: 20, shieldHeight: 2.6, socketX: 12, socket: 2.6, plug: 1.2 } as const;

const vtx = (): ModelMesh[] => {
  const shield = block({ x: VTX.x, z: 0, width: VTX.shield, depth: VTX.shield, height: VTX.shieldHeight });
  const socket = block({ x: VTX.x + VTX.socketX, z: 0, width: VTX.socket, depth: VTX.socket, height: VTX.plug });
  return [
    ...board(VTX.side, VTX.holeAt).map((mesh) => ({ ...mesh, geometry: mesh.geometry.translate(VTX.x, 0, 0) })),
    { geometry: shield, finish: FINISH.shield },
    { geometry: socket, finish: FINISH.steel },
  ];
};

const BUTTON = { z: 12, side: 3, height: 0.8, cap: 0.9, capHeight: 0.6 } as const;

const button = (): ModelMesh[] => {
  const body = block({ x: VTX.x, z: BUTTON.z, width: BUTTON.side, depth: BUTTON.side, height: BUTTON.height });
  const cap = upright(BUTTON.cap, TOP + BUTTON.height, TOP + BUTTON.height + BUTTON.capHeight, VTX.x, BUTTON.z);
  return [{ geometry: body, finish: FINISH.steel }, { geometry: cap, finish: FINISH.plastic }];
};

const SMA = { from: 26, length: 8, radius: 3.2, y: 4, cable: 0.6 } as const;

const pigtail = (): ModelMesh[] => {
  const start = VTX.x + VTX.socketX;
  const cable = tube([
    at(start, TOP + VTX.plug, 0),
    at(start + SMA.y, SMA.y, 0),
    at(SMA.from, SMA.y, 0),
  ], SMA.cable);
  return [
    { geometry: cable, finish: FINISH.wire },
    { geometry: alongX(SMA.radius, SMA.length, SMA.from + SMA.length * HALF, SMA.y, 0), finish: FINISH.steel },
  ];
};

const ANTENNA = { nut: 3.5, nutLength: 4, stem: 1.8, top: 34, head: 7, headDepth: 4 } as const;

const antenna = (): ModelMesh[] => {
  const nutFrom = SMA.from + SMA.length;
  const stemX = nutFrom + ANTENNA.nutLength + ANTENNA.stem;
  return [
    {
      geometry: alongX(ANTENNA.nut, ANTENNA.nutLength, nutFrom + ANTENNA.nutLength * HALF, SMA.y, 0),
      finish: FINISH.steel,
    },
    {
      geometry: merged([
        upright(ANTENNA.stem, SMA.y - ANTENNA.stem, ANTENNA.top, stemX, 0),
        alongZ(ANTENNA.head, ANTENNA.headDepth, stemX, ANTENNA.top + ANTENNA.head, 0),
      ]),
      finish: FINISH.cover,
    },
  ];
};

const WIRE = { radius: 0.9, y: 2.4, back: -14, plugZ: -20, reach: 12 } as const;

const wires = (): ModelMesh[] => [
  ...lead([
    at(CAMERA.x, WIRE.y + WIRE.y, BACK),
    at(CAMERA.x, WIRE.y, WIRE.back),
  ], at(CAMERA.x + WIRE.reach, WIRE.y, WIRE.plugZ), WIRE.radius),
  ...lead([
    at(VTX.x - VTX.side * HALF, TOP + WIRE.radius, VTX.holeAt * HALF),
    at(VTX.x - VTX.side * HALF - WIRE.reach * HALF, WIRE.y, WIRE.back),
  ], at(VTX.x - VTX.side * HALF, WIRE.y, WIRE.plugZ), WIRE.radius),
];

const piece = <Id extends string>(id: Id, offset: number, meshes: readonly ModelMesh[]): ModelPiece<Id> =>
  ({ id, offset, spins: false, meshes });

const ANALOG_OFFSET = { camera: 4, lens: 12, button: 8, pigtail: 5, antenna: 14, wires: -6 } as const;

/**
 * Builds a typical analog video system for a 5 inch quad, from its dimensions in millimetres: a micro camera, a VTX
 * on a 20×20 mount, and a lollipop antenna on an SMA pigtail.
 *
 * @returns The system's pieces, in the order the atlas lists them.
 */
export const buildAnalogVideo = (): Model<AnalogPiece> => ({
  elevation: VIEW,
  phases: 0,
  polePairs: 0,
  pieces: [
    piece(AnalogPiece.Camera, ANALOG_OFFSET.camera, camera()),
    piece(AnalogPiece.Lens, ANALOG_OFFSET.lens, lens()),
    piece(AnalogPiece.Vtx, 0, vtx()),
    piece(AnalogPiece.Button, ANALOG_OFFSET.button, button()),
    piece(AnalogPiece.Pigtail, ANALOG_OFFSET.pigtail, pigtail()),
    piece(AnalogPiece.Antenna, ANALOG_OFFSET.antenna, antenna()),
    piece(AnalogPiece.Wires, ANALOG_OFFSET.wires, wires()),
  ],
});

const AIR = {
  x: 6,
  side: 30,
  height: 7,
  plate: 1,
  fins: { first: -12, step: 4, count: 7 },
  fin: 1.2,
  finHeight: 4,
} as const;
const AIR_EDGE = AIR.side * HALF;

const COAX = { radius: 0.6, y: 9, back: -13, dip: 5 } as const;

const cameraCable = (): ModelMesh[] => [{
  geometry: tube([
    at(CAMERA.x, COAX.y, BACK),
    at(CAMERA.x, COAX.y, COAX.back),
    at(AIR.x - AIR_EDGE - COAX.dip, COAX.dip, COAX.back),
    at(AIR.x - AIR_EDGE, COAX.dip, 0),
  ], COAX.radius),
  finish: FINISH.wire,
}];

const airUnit = (): ModelMesh[] => [{
  geometry: block({ x: AIR.x, z: 0, width: AIR.side, depth: AIR.side, height: AIR.height }, 0),
  finish: FINISH.casing,
}];

const heatsink = (): ModelMesh[] => {
  const plate = block({ x: AIR.x, z: 0, width: AIR.side, depth: AIR.side, height: AIR.plate }, AIR.height);
  const fins = positions(AIR.fins).map((x) =>
    block({ x: AIR.x + x, z: 0, width: AIR.fin, depth: AIR.side, height: AIR.finHeight }, AIR.height + AIR.plate));
  return [{ geometry: merged([plate, ...fins]), finish: FINISH.shield }];
};

const DIPOLE = { x: 8, z: -24, lead: 0.5, radius: 1.4, from: 6, to: 30 } as const;

const antennas = (): ModelMesh[] => {
  const xs = SIDES.map((side) => AIR.x + side * DIPOLE.x);
  const leads = xs.map((x) => tube([
    at(x, AIR.height * HALF, -AIR_EDGE),
    at(x, AIR.height * HALF, DIPOLE.z * HALF - AIR_EDGE * HALF),
    at(x, DIPOLE.from, DIPOLE.z),
  ], DIPOLE.lead));
  const sticks = xs.map((x) => upright(DIPOLE.radius, DIPOLE.from, DIPOLE.to, x, DIPOLE.z));
  return [{ geometry: merged(leads), finish: FINISH.wire }, { geometry: merged(sticks), finish: FINISH.cover }];
};

const FC_LEAD = { y: 3, out: 6, z: 8 } as const;

const fcCable = (): ModelMesh[] => lead([
  at(AIR.x + AIR_EDGE, FC_LEAD.y, FC_LEAD.out),
  at(AIR.x + AIR_EDGE + FC_LEAD.out, FC_LEAD.y, FC_LEAD.z),
], at(AIR.x + AIR_EDGE + FC_LEAD.z + FC_LEAD.out, FC_LEAD.y, FC_LEAD.y), WIRE.radius);

const DIGITAL_OFFSET = { camera: 4, cable: 8, heatsink: 10, antennas: 14, fc: -6 } as const;

/**
 * Builds a typical digital video system for a 5 inch quad, from its dimensions in millimetres: a camera on a coax
 * cable to an air unit with a heatsink, two antennas and a cable to the flight controller.
 *
 * @returns The system's pieces, in the order the atlas lists them.
 */
export const buildDigitalVideo = (): Model<DigitalPiece> => ({
  elevation: VIEW,
  phases: 0,
  polePairs: 0,
  pieces: [
    piece(DigitalPiece.Camera, DIGITAL_OFFSET.camera, [...camera(), ...lens()]),
    piece(DigitalPiece.CameraCable, DIGITAL_OFFSET.cable, cameraCable()),
    piece(DigitalPiece.AirUnit, 0, airUnit()),
    piece(DigitalPiece.Heatsink, DIGITAL_OFFSET.heatsink, heatsink()),
    piece(DigitalPiece.Antennas, DIGITAL_OFFSET.antennas, antennas()),
    piece(DigitalPiece.FcCable, DIGITAL_OFFSET.fc, fcCable()),
  ],
});
