import { CylinderGeometry } from "three";
import {
  block,
  board,
  FROM_ABOVE,
  grommets,
  HALF,
  merged,
  PCB_FINISH,
  positions,
  stackConnector,
  TOP,
} from "./pcb-model.ts";
import type { Block } from "./pcb-model.ts";
import type { Model, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the flight controller, in the order the atlas lists them. */
export const FcPiece = {
  Board: "board",
  Processor: "processor",
  Gyro: "gyro",
  Osd: "osd",
  Flash: "flash",
  Regulators: "regulators",
  UsbPort: "usb-port",
  BootButton: "boot-button",
  EscConnector: "esc-connector",
  Pads: "pads",
  Grommets: "grommets",
} as const;
/** One of the {@link FcPiece} values. */
export type FcPiece = (typeof FcPiece)[keyof typeof FcPiece];

const OFFSET = {
  processor: 10,
  gyro: 14,
  osd: 8,
  flash: 9,
  regulators: 7,
  usb: 6,
  boot: 11,
  connector: 12,
  grommets: -8,
} as const;

const BOARD_SIDE = 36;
const EDGE = BOARD_SIDE * HALF;

const PROCESSOR = { x: -6, z: 5, width: 7, depth: 7, height: 1.2 } as const;
const GYRO = { x: 0, z: 0, width: 3, depth: 3, height: 0.9 } as const;
const OSD = { x: 6, z: 6, width: 5, depth: 5, height: 1 } as const;
const FLASH = { x: 6, z: -3, width: 4, depth: 5, height: 0.9 } as const;

const chip = (at: Block): ModelMesh[] => [{ geometry: block(at), finish: PCB_FINISH.chip }];

const REGULATOR = {
  columns: { first: -9, step: 5, count: 2 },
  chipZ: -7,
  chip: 2.5,
  chipHeight: 0.8,
  coilZ: -11,
  coil: 3.4,
  coilHeight: 1.8,
} as const;

const regulators = (): ModelMesh[] => {
  const columns = positions(REGULATOR.columns);
  const chips = columns.map((x) =>
    block({ x, z: REGULATOR.chipZ, width: REGULATOR.chip, depth: REGULATOR.chip, height: REGULATOR.chipHeight }));
  const coils = columns.map((x) =>
    block({ x, z: REGULATOR.coilZ, width: REGULATOR.coil, depth: REGULATOR.coil, height: REGULATOR.coilHeight }));
  return [{ geometry: merged(chips), finish: PCB_FINISH.chip }, { geometry: merged(coils), finish: PCB_FINISH.steel }];
};

const USB = { reach: 0.4, length: 7.4, width: 9, height: 3.2 } as const;

const usbPort = (): ModelMesh[] => [{
  geometry: block({
    x: USB.length * HALF - EDGE - USB.reach,
    z: 0,
    width: USB.length,
    depth: USB.width,
    height: USB.height,
  }),
  finish: PCB_FINISH.steel,
}];

const BOOT = { x: -12.5, z: 8.5, side: 3.4, height: 0.8, cap: 0.9, capHeight: 0.6, sides: 16 } as const;

const bootButton = (): ModelMesh[] => {
  const body = block({ x: BOOT.x, z: BOOT.z, width: BOOT.side, depth: BOOT.side, height: BOOT.height });
  const cap = new CylinderGeometry(BOOT.cap, BOOT.cap, BOOT.capHeight, BOOT.sides)
    .translate(BOOT.x, TOP + BOOT.height + BOOT.capHeight * HALF, BOOT.z);
  return [{ geometry: body, finish: PCB_FINISH.steel }, { geometry: cap, finish: PCB_FINISH.plastic }];
};

const CONNECTOR_Z = 14;

const PAD = {
  side: { first: -10, step: 2.6, count: 9 },
  front: { first: -7.5, step: 3, count: 6 },
  inset: 1.4,
  width: 1.8,
  depth: 1.4,
  height: 0.08,
} as const;

const pads = (): ModelMesh[] => {
  const side = positions(PAD.side).map((z) =>
    block({ x: EDGE - PAD.inset, z, width: PAD.width, depth: PAD.depth, height: PAD.height }));
  const front = positions(PAD.front).map((x) =>
    block({ x, z: PAD.inset - EDGE, width: PAD.depth, depth: PAD.width, height: PAD.height }));
  return [{ geometry: merged([...side, ...front]), finish: PCB_FINISH.gold }];
};

/**
 * Builds a typical 30.5×30.5 mm flight controller for a 5 inch quad, from its dimensions in millimetres: a processor,
 * gyro, OSD chip and blackbox flash, with the USB port on one edge and the ESC socket on the other.
 *
 * @returns The flight controller's pieces, in the order the atlas lists them.
 */
export const buildFc = (): Model<FcPiece> => {
  const piece = (id: FcPiece, offset: number, meshes: readonly ModelMesh[]): ModelPiece<FcPiece> =>
    ({ id, offset, spins: false, meshes });
  return {
    elevation: FROM_ABOVE,
    phases: 0,
    polePairs: 0,
    pieces: [
      piece(FcPiece.Board, 0, board(BOARD_SIDE)),
      piece(FcPiece.Processor, OFFSET.processor, chip(PROCESSOR)),
      piece(FcPiece.Gyro, OFFSET.gyro, chip(GYRO)),
      piece(FcPiece.Osd, OFFSET.osd, chip(OSD)),
      piece(FcPiece.Flash, OFFSET.flash, chip(FLASH)),
      piece(FcPiece.Regulators, OFFSET.regulators, regulators()),
      piece(FcPiece.UsbPort, OFFSET.usb, usbPort()),
      piece(FcPiece.BootButton, OFFSET.boot, bootButton()),
      piece(FcPiece.EscConnector, OFFSET.connector, stackConnector(CONNECTOR_Z)),
      piece(FcPiece.Pads, 0, pads()),
      piece(FcPiece.Grommets, OFFSET.grommets, grommets()),
    ],
  };
};
