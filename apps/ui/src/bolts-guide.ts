import { BoltPiece } from "./bolts-model.ts";
import type { PartGuide } from "./motor-guide.ts";

/** What the atlas says about the bolts as a whole. */
export const BOLTS_GUIDE: PartGuide = {
  name: "Bolts",
  what: "The screws and nuts that hold a quad together. Most on a 5 inch are M3, 3 mm across the thread.",
  how: "Each job has its own kind: socket heads on the motors, button heads on the frame, long screws through the "
    + "stack and a locking nut on each prop.",
  fails: "Motor screws can work loose. Blue thread locker on the motor screws helps, but keep it off anything that "
    + "touches the props.",
  specs: "Thread size, length and material. Steel is strong and cheap, aluminium light but soft, titanium strong and "
    + "light but expensive.",
};

/** What the atlas says about each fastener. */
export const BOLT_PIECE_GUIDES: Readonly<Record<BoltPiece, PartGuide>> = {
  [BoltPiece.MotorScrew]: {
    name: "Motor screw",
    what: "An M3 socket head screw that holds a motor to its arm, four to a motor.",
    how: "It goes up through the arm into threaded holes in the motor's base.",
    fails: "One too long reaches the stator windings, grinding them or wearing through their coating, which can short "
      + "the motor.",
    specs: "Take the arm's thickness off the screw's length: what is left goes into the motor, and must fit its "
      + "holes. Small quads use M2.",
  },
  [BoltPiece.FrameScrew]: {
    name: "Frame screw",
    what: "An M3 button head screw, the most common screw on a frame: arms, plates and standoffs.",
    how: "Its low, rounded head sits close to the plate.",
    fails: "Aluminium screws are light but soft, and strip if overtightened.",
    specs: "Usually 6 to 10 mm long on small frames and 10 to 16 mm on larger ones.",
  },
  [BoltPiece.StackScrew]: {
    name: "Stack screw",
    what: "A long screw that runs up through the flight controller and ESC stack.",
    how: "It goes up through the bottom plate, with nuts or grommets holding each board in place on it.",
    fails: "Bare metal touching a board's pads can short it, which is why nylon nuts are used around the boards.",
    specs: "M3 for a 30.5×30.5 mm stack and M2 for 20×20 mm, long enough to pass through every board.",
  },
  [BoltPiece.StackNut]: {
    name: "Nylon nut",
    what: "An M3 nylon nut that holds the boards on the stack screws.",
    how: "Nylon does not conduct, so it can touch a board safely, and it is lighter than metal.",
    fails: "It is weaker than a metal nut. Some builders find that spares the board's mounting holes in a crash; "
      + "others use steel all the way through.",
    specs: "It must match the stack screw: M3 or M2.",
  },
  [BoltPiece.Grommet]: {
    name: "Grommet",
    what: "A rubber ring that the flight controller sits in, one on each stack screw.",
    how: "The rubber soaks up vibration from the motors before it reaches the gyro on the flight controller.",
    fails: "Squashed by an overtightened nut, it stops damping.",
    specs: "Most flight controllers come with them. Some are sold in soft, medium and hard.",
  },
  [BoltPiece.PropNut]: {
    name: "Prop nut",
    what: "An M5 nut that holds the prop on the motor's shaft.",
    how: "Its flange spreads the clamping force over the prop, and a nylon ring inside grips the thread so it does "
      + "not shake loose.",
    fails: "The nylon wears with use, and a worn nut can back off and let the prop fly off. Overtightening can damage "
      + "the prop's hub.",
    specs: "Some motors have reverse threaded shafts, which need matching nuts.",
  },
};

/** Common FPV fastener sizes, for the table under the bolts. */
export const BOLT_SIZES = [
  {
    fastener: "Motor screws",
    thread: "M3, M2 on small quads",
    length: "Arm thickness plus what the motor's holes take",
    where: "Motor to arm",
    watch: "Too long reaches the windings",
  },
  {
    fastener: "Frame screws",
    thread: "M3",
    length: "6 to 10 mm on small frames, 10 to 16 mm on larger",
    where: "Arms, plates and standoffs",
    watch: "Aluminium strips easily",
  },
  {
    fastener: "Stack screws",
    thread: "M3 for 30.5×30.5, M2 for 20×20",
    length: "Through every board in the stack",
    where: "Flight controller and ESC",
    watch: "Bare metal on a pad can short it",
  },
  {
    fastener: "Stack nuts",
    thread: "M3 or M2, nylon",
    length: "A nut",
    where: "Between and on top of the boards",
    watch: "Overtightening squashes the grommets",
  },
  {
    fastener: "Camera screws",
    thread: "M2 or M1.6",
    length: "Often 4 mm",
    where: "Camera to its side plates",
    watch: "Check the length your camera takes",
  },
  {
    fastener: "Prop nuts",
    thread: "M5, nylon locking",
    length: "A nut",
    where: "Prop to motor shaft",
    watch: "Worn nylon lets it back off",
  },
] as const;
