import { FramePiece } from "./frame-model.ts";
import type { PartGuide } from "./motor-guide.ts";

/** What the atlas says about the whole frame. */
export const FRAME_GUIDE: PartGuide = {
  name: "5 inch frame",
  what: "The skeleton every other part bolts to. It carries the motors at the ends of its arms and protects the "
    + "electronics in its body.",
  how: "Carbon fibre plates and arms, held apart by standoffs. This one is a true X: all four motors sit the same "
    + "distance from the centre, for even pitch and roll.",
  fails: "Carbon fibre conducts electricity, so a bare wire touching the frame can short and burn parts. It also "
    + "blocks radio, so antennas go outside it.",
  specs: "Frames are named by the largest prop they take. The wheelbase, the diagonal distance between motors, is "
    + "about 220 mm on a 5 inch.",
};

/** What the atlas says about each piece of the frame. */
export const FRAME_PIECE_GUIDES: Readonly<Record<FramePiece, PartGuide>> = {
  [FramePiece.BottomPlate]: {
    name: "Bottom plate",
    what: "The plate the arms and the electronics stack are bolted to.",
    how: "The flight controller and ESC stack mounts on its centre holes, and the arms are clamped to it.",
    fails: "Plates cut at an angle to the carbon's weave are weaker, and sharp edges can cut wires and straps.",
    specs: "Its stack holes must match your boards: 30.5×30.5 mm on most 5 inch builds, 20×20 mm for smaller stacks.",
  },
  [FramePiece.Arms]: {
    name: "Arms",
    what: "Four separate arms, each carrying a motor at its tip.",
    how: "Each arm is clamped to the body, so a broken one can be swapped alone. A one-piece frame is lighter, but a "
      + "broken arm means a new plate and moving every motor.",
    fails: "Arms are the first place to break in a crash. Hard angles in an arm break more readily than curves.",
    specs: "At least 5 mm thick on a 5 inch, 6 mm for harder hits. Motor holes must match your motors, usually 16×16 "
      + "mm, and motor screws too long for the arm can reach the windings and short the motor.",
  },
  [FramePiece.ArmScrews]: {
    name: "Arm screws",
    what: "M3 screws that clamp each arm to the body, two per arm.",
    how: "On frames like this an arm comes out without taking the stack apart.",
    fails: "Loose arm screws let the arms shift, which shakes the whole quad.",
    specs: "Steel is the strongest and heaviest, aluminium light but soft and strips easily, titanium light and "
      + "strong but expensive.",
  },
  [FramePiece.Standoffs]: {
    name: "Standoffs",
    what: "Aluminium posts that hold the top plate above the bottom one.",
    how: "Their height sets the room inside the body for the stack and its wiring.",
    fails: "Aluminium threads strip if the screws are overtightened.",
    specs: "Tall enough for your stack and the camera: about 30 mm here.",
  },
  [FramePiece.TopPlate]: {
    name: "Top plate",
    what: "The plate that closes the body. The battery sits on it.",
    how: "For freestyle the battery usually goes on top, keeping its weight closer to the props and away from "
      + "landings.",
    fails: "Sharp edges can cut the battery strap.",
    specs: "Often 2 to 3 mm thick, with slots for the strap.",
  },
  [FramePiece.CameraPlates]: {
    name: "Camera plates",
    what: "Side plates at the front that hold the FPV camera between them.",
    how: "The camera bolts in from each side and can be tilted up, to look ahead when the quad leans forward to fly "
      + "fast.",
    fails: "The camera sits at the front, where most crashes hit first.",
    specs: "Cameras come in micro and nano sizes, and the plates must suit yours. A micro camera is 19 mm wide.",
  },
  [FramePiece.BatteryStrap]: {
    name: "Battery strap",
    what: "The strap that holds the battery down on the top plate.",
    how: "It runs through slots in the top plate and around the battery.",
    fails: "A worn or cut strap lets the battery fly off in a crash.",
    specs: "It must fit the plate's slots. A grippy pad under the battery stops it sliding.",
  },
};
