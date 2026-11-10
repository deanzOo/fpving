import { CylinderGeometry, ExtrudeGeometry, Path, Shape } from "three";
import type { BufferGeometry } from "three";
import { block, HALF, merged, QUARTER_TURN, SIDES } from "./pcb-model.ts";
import type { Model, ModelFinish, ModelPiece } from "./ui/model-stage.ts";

/** The printed TPU parts, in the order the atlas lists them. */
export const TpuPiece = {
  Canopy: "canopy",
  GoproMount: "gopro-mount",
  CameraMount: "camera-mount",
  AntennaMount: "antenna-mount",
  ArmGuard: "arm-guard",
  Xt60Holder: "xt60-holder",
} as const;
/** One of the {@link TpuPiece} values. */
export type TpuPiece = (typeof TpuPiece)[keyof typeof TpuPiece];

const VIEW = 0.45;
const SPACING = 40;
const ROUND = 32;
const TPU: ModelFinish = { token: "model-tpu", roughness: 0.75, metalness: 0 };

const extruded = (shape: Shape, depth: number): BufferGeometry =>
  new ExtrudeGeometry(shape, { depth, curveSegments: ROUND, bevelEnabled: false }).translate(0, 0, -depth * HALF);

const CANOPY = { outer: 15, wall: 1.6, length: 34 } as const;

const canopy = (): BufferGeometry => {
  const inner = CANOPY.outer - CANOPY.wall;
  const arch = new Shape()
    .moveTo(CANOPY.outer, 0)
    .absarc(0, 0, CANOPY.outer, 0, Math.PI, false)
    .lineTo(-inner, 0)
    .absarc(0, 0, inner, Math.PI, 0, true)
    .lineTo(CANOPY.outer, 0);
  return extruded(arch, CANOPY.length);
};

const GOPRO = { base: 24, depth: 22, plate: 2.5, fins: 3, fin: 3, gap: 3.2, height: 12, finDepth: 12 } as const;

const goproMount = (): BufferGeometry => {
  const plate = block({ x: 0, z: 0, width: GOPRO.base, depth: GOPRO.depth, height: GOPRO.plate }, 0);
  const pitch = GOPRO.fin + GOPRO.gap;
  const fins = Array.from({ length: GOPRO.fins }, (_none, index) => {
    const x = (index - (GOPRO.fins - 1) * HALF) * pitch;
    const body = block({ x, z: 0, width: GOPRO.fin, depth: GOPRO.finDepth, height: GOPRO.height }, GOPRO.plate);
    const round = new CylinderGeometry(GOPRO.finDepth * HALF, GOPRO.finDepth * HALF, GOPRO.fin, ROUND)
      .rotateZ(QUARTER_TURN)
      .translate(x, GOPRO.plate + GOPRO.height, 0);
    return merged([body, round]);
  });
  return merged([plate, ...fins]);
};

const CRADLE = { width: 25, depth: 20, floor: 2, side: 2.5, height: 21 } as const;

const cameraMount = (): BufferGeometry => {
  const floor = block({ x: 0, z: 0, width: CRADLE.width, depth: CRADLE.depth, height: CRADLE.floor }, 0);
  const sides = SIDES.map((side) => block({
    x: side * (CRADLE.width - CRADLE.side) * HALF,
    z: 0,
    width: CRADLE.side,
    depth: CRADLE.depth,
    height: CRADLE.height,
  }, 0));
  return merged([floor, ...sides]);
};

const ANTENNA = { pad: 16, padDepth: 12, padHeight: 3, outer: 4, bore: 2.2, length: 22, tilt: 0.5 } as const;

const antennaMount = (): BufferGeometry => {
  const pad = block({ x: 0, z: 0, width: ANTENNA.pad, depth: ANTENNA.padDepth, height: ANTENNA.padHeight }, 0);
  const ring = new Shape().absarc(0, 0, ANTENNA.outer, 0, Math.PI + Math.PI, false);
  ring.holes.push(new Path().absarc(0, 0, ANTENNA.bore, 0, Math.PI + Math.PI, true));
  const sleeve = new ExtrudeGeometry(ring, { depth: ANTENNA.length, curveSegments: ROUND, bevelEnabled: false })
    .rotateX(-QUARTER_TURN)
    .rotateX(-ANTENNA.tilt)
    .translate(0, ANTENNA.padHeight, 0);
  return merged([pad.toNonIndexed(), sleeve]);
};

const GUARD = { width: 16, height: 10, wall: 2.4, slot: 5, length: 22 } as const;

const armGuard = (): BufferGeometry => {
  const half = GUARD.width * HALF;
  const inner = half - GUARD.wall;
  const clip = new Shape()
    .moveTo(-half, 0)
    .lineTo(-half, GUARD.height)
    .lineTo(half, GUARD.height)
    .lineTo(half, 0)
    .lineTo(inner, 0)
    .lineTo(inner, GUARD.height - GUARD.wall)
    .lineTo(-inner, GUARD.height - GUARD.wall)
    .lineTo(-inner, 0)
    .lineTo(-half, 0);
  return extruded(clip, GUARD.length);
};

const HOLDER = { width: 22, height: 12, depth: 12, plugWidth: 16, plugHeight: 8 } as const;

const xt60Holder = (): BufferGeometry => {
  const half = HOLDER.width * HALF;
  const frame = new Shape()
    .moveTo(-half, 0)
    .lineTo(half, 0)
    .lineTo(half, HOLDER.height)
    .lineTo(-half, HOLDER.height)
    .lineTo(-half, 0);
  const plug = HOLDER.plugWidth * HALF;
  const floor = (HOLDER.height - HOLDER.plugHeight) * HALF;
  frame.holes.push(new Path()
    .moveTo(-plug, floor)
    .lineTo(-plug, floor + HOLDER.plugHeight)
    .lineTo(plug, floor + HOLDER.plugHeight)
    .lineTo(plug, floor)
    .lineTo(-plug, floor));
  return extruded(frame, HOLDER.depth);
};

const BUILDERS = {
  [TpuPiece.Canopy]: canopy,
  [TpuPiece.GoproMount]: goproMount,
  [TpuPiece.CameraMount]: cameraMount,
  [TpuPiece.AntennaMount]: antennaMount,
  [TpuPiece.ArmGuard]: armGuard,
  [TpuPiece.Xt60Holder]: xt60Holder,
} as const satisfies Readonly<Record<TpuPiece, () => BufferGeometry>>;

/**
 * Builds a row of TPU parts printed for a typical 5 inch quad, from their dimensions in millimetres, each standing on
 * the same ground.
 *
 * @returns The parts, in the order the atlas lists them.
 */
export const buildTpuParts = (): Model<TpuPiece> => {
  const ids = Object.values(TpuPiece);
  const middle = (ids.length - 1) * HALF;
  return {
    elevation: VIEW,
    phases: 0,
    polePairs: 0,
    pieces: ids.map((id, index): ModelPiece<TpuPiece> => ({
      id,
      offset: 0,
      spins: false,
      meshes: [{ geometry: BUILDERS[id]().translate((index - middle) * SPACING, 0, 0), finish: TPU }],
    })),
  };
};
