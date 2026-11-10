import { CatmullRomCurve3, CylinderGeometry, TubeGeometry, Vector3 } from "three";
import type { BufferGeometry } from "three";
import { block, HALF, merged, PCB_FINISH, positions, QUARTER_TURN, SIDES } from "./pcb-model.ts";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the battery, in the order the atlas lists them. */
export const BatteryPiece = {
  Cells: "cells",
  Wrap: "wrap",
  Leads: "leads",
  Xt60: "xt60",
  BalanceLead: "balance-lead",
} as const;
/** One of the {@link BatteryPiece} values. */
export type BatteryPiece = (typeof BatteryPiece)[keyof typeof BatteryPiece];

/** How many cells the pack has in series: the S in 6S. */
export const CELLS = 6;

const VIEW = 0.5;
const ROUND = 24;

const FINISH = {
  ...PCB_FINISH,
  pouch: { token: "model-bell", roughness: 0.35, metalness: 0.7 },
  wrap: { token: "model-wrap", roughness: 0.6, metalness: 0 },
  plug: { token: "model-plug", roughness: 0.5, metalness: 0 },
  wire: { token: "model-wire", roughness: 0.7, metalness: 0 },
  positive: { token: "model-positive", roughness: 0.55, metalness: 0 },
  negative: { token: "model-negative", roughness: 0.55, metalness: 0 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const PACK = { length: 72, width: 35, cell: 5.6, gap: 0.2, wrap: 0.6 } as const;
const END = PACK.length * HALF;
const STEP = PACK.cell + PACK.gap;
const TOP = PACK.wrap + CELLS * STEP;

const OFFSET = { wrap: 18, xt60: 6, balance: 4 } as const;

const at = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const tube = (points: readonly Vector3[], radius: number): BufferGeometry =>
  new TubeGeometry(new CatmullRomCurve3([...points]), ROUND, radius, ROUND * HALF);

const cells = (): ModelMesh[] => positions({ first: PACK.wrap, step: STEP, count: CELLS }).map((base) => ({
  geometry: block({ x: 0, z: 0, width: PACK.length, depth: PACK.width, height: PACK.cell }, base),
  finish: FINISH.pouch,
}));

const wrap = (): ModelMesh[] => {
  const outer = PACK.width + PACK.wrap + PACK.wrap;
  const side = (z: number) =>
    block({ x: 0, z, width: PACK.length, depth: PACK.wrap, height: TOP + PACK.wrap }, 0);
  return [{
    geometry: merged([
      block({ x: 0, z: 0, width: PACK.length, depth: outer, height: PACK.wrap }, 0),
      block({ x: 0, z: 0, width: PACK.length, depth: outer, height: PACK.wrap }, TOP),
      side((PACK.width + PACK.wrap) * HALF),
      side(-(PACK.width + PACK.wrap) * HALF),
    ]),
    finish: FINISH.wrap,
  }];
};

const XT60_REACH = 30;
const XT60 = {
  x: END + XT60_REACH,
  y: 6,
  length: 16,
  height: 8,
  width: 15.5,
  pin: 1.75,
  pinLength: 6,
  pitch: 7.2,
} as const;
const LEAD = { radius: 1.6, z: 4, drop: 4, out: 12 } as const;

const leads = (): ModelMesh[] => {
  const lead = (side: number): BufferGeometry => tube([
    at(END, TOP - LEAD.drop, side * LEAD.z),
    at(END + LEAD.out, TOP - LEAD.drop, side * LEAD.z),
    at(XT60.x - XT60.length * HALF, XT60.y, side * XT60.pitch * HALF),
  ], LEAD.radius);
  return [{ geometry: lead(1), finish: FINISH.positive }, { geometry: lead(-1), finish: FINISH.negative }];
};

const xt60 = (): ModelMesh[] => {
  const housing = block(
    { x: XT60.x, z: 0, width: XT60.length, depth: XT60.width, height: XT60.height },
    XT60.y - XT60.height * HALF,
  );
  const pins = SIDES.map((side) => new CylinderGeometry(XT60.pin, XT60.pin, XT60.pinLength, ROUND)
    .rotateZ(QUARTER_TURN)
    .translate(XT60.x + (XT60.length + XT60.pinLength) * HALF, XT60.y, side * XT60.pitch * HALF));
  return [{ geometry: housing, finish: FINISH.plug }, { geometry: merged(pins), finish: FINISH.gold }];
};

const BALANCE_REACH = 12;
const BALANCE = {
  x: END + BALANCE_REACH,
  y: 3,
  z: -30,
  pitch: 2.5,
  depth: 7,
  height: 6,
  wire: 0.55,
  exitZ: -16,
  exitStep: 1.3,
  bend: 6,
} as const;

const balanceLead = (): ModelMesh[] => {
  const count = CELLS + 1;
  const width = count * BALANCE.pitch;
  const wires = Array.from({ length: count }, (_none, index) => {
    const offset = index - (count - 1) * HALF;
    const exit = at(END, TOP - BALANCE.wire - BALANCE.wire, BALANCE.exitZ + offset * BALANCE.exitStep);
    return {
      geometry: tube([
        exit,
        at(END + BALANCE.bend, TOP - BALANCE.bend * HALF, exit.z - BALANCE.bend),
        at(BALANCE.x - BALANCE.depth * HALF, BALANCE.y, BALANCE.z + offset * BALANCE.pitch),
      ], BALANCE.wire),
      finish: FINISH.wire,
    };
  });
  const plug = block(
    { x: BALANCE.x, z: BALANCE.z, width: BALANCE.depth, depth: width, height: BALANCE.height },
    BALANCE.y - BALANCE.height * HALF,
  );
  return [...wires, { geometry: plug, finish: FINISH.plastic }];
};

/**
 * Builds a typical 6S 1300 mAh LiPo for a 5 inch quad, from its dimensions in millimetres: six pouch cells in a
 * wrap, with the main leads to an XT60 and a balance lead coming out of one end.
 *
 * @returns The battery's pieces, in the order the atlas lists them.
 */
export const buildBattery = (): Model<BatteryPiece> => {
  const piece = (id: BatteryPiece, offset: number, meshes: readonly ModelMesh[]): ModelPiece<BatteryPiece> =>
    ({ id, offset, spins: false, meshes });
  return {
    elevation: VIEW,
    phases: 0,
    polePairs: 0,
    pieces: [
      piece(BatteryPiece.Cells, 0, cells()),
      piece(BatteryPiece.Wrap, OFFSET.wrap, wrap()),
      piece(BatteryPiece.Leads, 0, leads()),
      piece(BatteryPiece.Xt60, OFFSET.xt60, xt60()),
      piece(BatteryPiece.BalanceLead, OFFSET.balance, balanceLead()),
    ],
  };
};
