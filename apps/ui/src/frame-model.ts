import { CylinderGeometry, ExtrudeGeometry, Path, Shape } from "three";
import type { BufferGeometry } from "three";
import { merged } from "./geometry.ts";
import type { Model, ModelFinish, ModelMesh, ModelPiece } from "./ui/model-stage.ts";

/** The pieces of the frame, in the order the atlas lists them. */
export const FramePiece = {
  BottomPlate: "bottom-plate",
  Arms: "arms",
  ArmScrews: "arm-screws",
  Standoffs: "standoffs",
  TopPlate: "top-plate",
  CameraPlates: "camera-plates",
  BatteryStrap: "battery-strap",
} as const;
/** One of the {@link FramePiece} values. */
export type FramePiece = (typeof FramePiece)[keyof typeof FramePiece];

/** The diagonal distance between two opposite motors, in millimetres. */
export const WHEELBASE = 220;

const WHOLE_TURN = Math.PI + Math.PI;
const HALF = 0.5;
const QUARTER_TURN = Math.PI * HALF;
const FROM_ABOVE = 0.7;
const SIDES = [-1, 1] as const;
const QUADRANTS = SIDES.flatMap((x) => SIDES.map((z) => ({ x, z })));
const CORNERS = [{ x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }] as const;
const MOTOR_AT = WHEELBASE * HALF * Math.SQRT1_2;
const CURVE = 24;

const FINISH = {
  carbon: { token: "model-carbon", roughness: 0.4, metalness: 0.2 },
  standoff: { token: "model-bell", roughness: 0.35, metalness: 1 },
  steel: { token: "model-steel", roughness: 0.3, metalness: 1 },
  strap: { token: "model-strap", roughness: 0.8, metalness: 0 },
} as const satisfies Readonly<Record<string, ModelFinish>>;

const OFFSET = {
  bottom: -12,
  screws: -30,
  standoffs: 14,
  top: 30,
  camera: 14,
  strap: 44,
} as const;

const BODY = { halfWidth: 22, halfLength: 50, corner: 4, bottom: 2.5, top: 2 } as const;
const ARM = { thickness: 5, halfWidth: 7, tip: 14.5, rootX: 10, rootZ: 26, bore: 3.5 } as const;
const HOLE = 1.6;
const STACK_AT = 15.25;
const MOTOR_PATTERN = { side: 16 } as const;
const MOTOR_HOLE_AT = MOTOR_PATTERN.side * Math.SQRT1_2;
const STANDOFF = { x: 17, z: 46, radius: 2.6, height: 30, sides: 6 } as const;
const SCREW = { first: 3, second: 11, head: 2.8, headHeight: 1.6, shank: 1.5, sides: 16 } as const;
const ARMS_AT = BODY.bottom;
const STANDOFFS_AT = BODY.bottom;
const TOP_AT = STANDOFFS_AT + STANDOFF.height;
const SLOT = { z: 15, halfWidth: 11, halfDepth: 1.5 } as const;

const roundedRect = (halfX: number, halfY: number, corner: number): Shape => {
  const shape = new Shape();
  CORNERS.forEach(({ x, z }, index) => {
    const start = (index - 1) * QUARTER_TURN;
    shape.absarc(x * (halfX - corner), z * (halfY - corner), corner, start, start + QUARTER_TURN, false);
  });
  shape.closePath();
  return shape;
};

const hole = (x: number, y: number, radius: number = HOLE): Path =>
  new Path().absarc(x, y, radius, 0, WHOLE_TURN, true);

const slot = (x: number, y: number, halfX: number, halfY: number): Path => new Path()
  .moveTo(x - halfX, y - halfY)
  .lineTo(x - halfX, y + halfY)
  .lineTo(x + halfX, y + halfY)
  .lineTo(x + halfX, y - halfY)
  .closePath();

const extruded = (shape: Shape, depth: number): ExtrudeGeometry =>
  new ExtrudeGeometry(shape, { depth, curveSegments: CURVE, bevelEnabled: false });

const flat = (shape: Shape, thickness: number, base: number): BufferGeometry =>
  extruded(shape, thickness).rotateX(QUARTER_TURN).translate(0, base + thickness, 0);

const upright = (shape: Shape, thickness: number): BufferGeometry =>
  extruded(shape, thickness).translate(0, 0, -thickness * HALF).rotateY(QUARTER_TURN);

const arms = QUADRANTS.map(({ x, z }) => {
  const root = { x: x * ARM.rootX, z: z * ARM.rootZ };
  const dx = x * MOTOR_AT - root.x;
  const dz = z * MOTOR_AT - root.z;
  const length = Math.hypot(dx, dz);
  const along = (distance: number) => ({ x: root.x + dx / length * distance, z: root.z + dz / length * distance });
  return { root, length, turn: Math.atan2(-dz, dx), screws: [along(SCREW.first), along(SCREW.second)] };
});

const plate = (base: number, thickness: number, holes: readonly Path[]): ModelMesh[] => {
  const shape = roundedRect(BODY.halfWidth, BODY.halfLength, BODY.corner);
  shape.holes.push(...holes);
  return [{ geometry: flat(shape, thickness, base), finish: FINISH.carbon }];
};

const standoffHoles = (): Path[] => QUADRANTS.map(({ x, z }) => hole(x * STANDOFF.x, z * STANDOFF.z));

const bottomPlate = (): ModelMesh[] => plate(0, BODY.bottom, [
  ...QUADRANTS.map(({ x, z }) => hole(x * STACK_AT, z * STACK_AT)),
  ...standoffHoles(),
  ...arms.flatMap(({ screws }) => screws.map((screw) => hole(screw.x, screw.z))),
]);

const arm = ({ root, length, turn }: (typeof arms)[number]): BufferGeometry => {
  const meet = Math.sqrt(ARM.tip * ARM.tip - ARM.halfWidth * ARM.halfWidth);
  const around = Math.PI - Math.asin(ARM.halfWidth / ARM.tip);
  const shape = new Shape()
    .moveTo(0, -ARM.halfWidth)
    .lineTo(length - meet, -ARM.halfWidth)
    .absarc(length, 0, ARM.tip, -around, around, false)
    .lineTo(0, ARM.halfWidth)
    .absarc(0, 0, ARM.halfWidth, QUARTER_TURN, Math.PI + QUARTER_TURN, false);
  shape.holes.push(
    hole(SCREW.first, 0),
    hole(SCREW.second, 0),
    hole(length, 0, ARM.bore),
    ...SIDES.flatMap((side) => [hole(length + side * MOTOR_HOLE_AT, 0), hole(length, side * MOTOR_HOLE_AT)]),
  );
  return flat(shape, ARM.thickness, ARMS_AT).rotateY(turn).translate(root.x, 0, root.z);
};

const armScrews = (): ModelMesh[] => {
  const spots = arms.flatMap(({ screws }) => screws);
  const shankLength = BODY.bottom + ARM.thickness;
  const heads = spots.map(({ x, z }) => new CylinderGeometry(SCREW.head, SCREW.head, SCREW.headHeight, SCREW.sides)
    .translate(x, -SCREW.headHeight * HALF, z));
  const shanks = spots.map(({ x, z }) => new CylinderGeometry(SCREW.shank, SCREW.shank, shankLength, SCREW.sides)
    .translate(x, shankLength * HALF, z));
  return [{ geometry: merged([...heads, ...shanks]), finish: FINISH.steel }];
};

const standoffs = (): ModelMesh[] => [{
  geometry: merged(QUADRANTS.map(({ x, z }) =>
    new CylinderGeometry(STANDOFF.radius, STANDOFF.radius, STANDOFF.height, STANDOFF.sides)
      .translate(x * STANDOFF.x, STANDOFFS_AT + STANDOFF.height * HALF, z * STANDOFF.z))),
  finish: FINISH.standoff,
}];

const topPlate = (): ModelMesh[] => plate(TOP_AT, BODY.top, [
  ...standoffHoles(),
  ...SIDES.map((side) => slot(0, side * SLOT.z, SLOT.halfWidth, SLOT.halfDepth)),
]);

const CAMERA = { x: 10.5, z: 43, halfLength: 7, thickness: 2, corner: 2, mount: 0.4 } as const;

const cameraPlates = (): ModelMesh[] => {
  const halfHeight = STANDOFF.height * HALF;
  const plates = SIDES.map((side) => {
    const shape = roundedRect(CAMERA.halfLength, halfHeight, CAMERA.corner);
    shape.holes.push(hole(0, halfHeight * CAMERA.mount));
    return upright(shape, CAMERA.thickness).translate(side * CAMERA.x, STANDOFFS_AT + halfHeight, CAMERA.z);
  });
  return [{ geometry: merged(plates), finish: FINISH.carbon }];
};

const STRAP = { width: 20, band: 1.5, gap: 0.3, corner: 1.2 } as const;

const batteryStrap = (): ModelMesh[] => {
  const middle = TOP_AT + BODY.top * HALF;
  const innerHalfY = BODY.top * HALF + STRAP.gap;
  const innerHalfX = SLOT.z - STRAP.band * HALF;
  const shape = roundedRect(innerHalfX + STRAP.band, innerHalfY + STRAP.band, STRAP.corner);
  shape.holes.push(slot(0, 0, innerHalfX, innerHalfY));
  return [{ geometry: upright(shape, STRAP.width).translate(0, middle, 0), finish: FINISH.strap }];
};

/**
 * Builds a typical 5 inch true X freestyle frame with separate arms, from its dimensions in millimetres: carbon plates
 * held apart by standoffs, camera side plates at the front and a battery strap on top.
 *
 * @returns The frame's pieces, in the order the atlas lists them.
 */
export const buildFrame = (): Model<FramePiece> => {
  const piece = (id: FramePiece, offset: number, meshes: readonly ModelMesh[]): ModelPiece<FramePiece> =>
    ({ id, offset, spins: false, meshes });
  return {
    elevation: FROM_ABOVE,
    phases: 0,
    polePairs: 0,
    pieces: [
      piece(FramePiece.BottomPlate, OFFSET.bottom, bottomPlate()),
      piece(FramePiece.Arms, 0, [{ geometry: merged(arms.map(arm)), finish: FINISH.carbon }]),
      piece(FramePiece.ArmScrews, OFFSET.screws, armScrews()),
      piece(FramePiece.Standoffs, OFFSET.standoffs, standoffs()),
      piece(FramePiece.TopPlate, OFFSET.top, topPlate()),
      piece(FramePiece.CameraPlates, OFFSET.camera, cameraPlates()),
      piece(FramePiece.BatteryStrap, OFFSET.strap, batteryStrap()),
    ],
  };
};
