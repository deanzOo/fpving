import { EscPiece } from "./esc-model.ts";
import type { PartGuide } from "./motor-guide.ts";

/** What the atlas says about the whole 4-in-1 ESC. */
export const ESC_GUIDE: PartGuide = {
  name: "4-in-1 ESC",
  what: "Four electronic speed controllers on one board, one per motor. It takes throttle commands from the flight "
    + "controller and switches battery power through each motor's coils.",
  how: "For each motor, power switches turn its three phases on and off thousands of times a second, in the order "
    + "that keeps it turning.",
  fails: "Shorts and faulty parts can burn it on first power. Power a new build through a smoke stopper, which limits "
    + "the current while you check.",
  specs: "The current rating is per motor, and a limit rather than what the motors draw. 30×30 boards suit 5 inch "
    + "and up, 20×20 boards 3 to 4 inch.",
};

/** What the atlas says about each piece of the ESC. */
export const ESC_PIECE_GUIDES: Readonly<Record<EscPiece, PartGuide>> = {
  [EscPiece.Board]: {
    name: "Board",
    what: "The circuit board everything is soldered to. It sits in the frame's stack with the flight controller.",
    how: "Copper on and inside it carries battery current to each motor's switches, and signals between the chips.",
    fails: "Crash damage is not always visible: a failed part can look perfectly normal.",
    specs: "The mounting pattern must match your frame and flight controller: 30.5×30.5 mm with M3 on most 5 inch "
      + "builds.",
  },
  [EscPiece.Mosfets]: {
    name: "MOSFETs",
    what: "The power switches. Six per motor here: a high and a low switch for each of its three phases.",
    how: "Each one switches on and off thousands of times a second, connecting a phase to battery positive or "
      + "negative.",
    fails: "They usually fail shorted, and a burnt one can look normal. A short between battery positive and a motor "
      + "pad points to one.",
    specs: "Bigger MOSFETs handle more current and voltage and are tougher, which matters more on 6S.",
  },
  [EscPiece.GateDrivers]: {
    name: "Gate drivers",
    what: "Chips that switch the MOSFETs on and off. A common one, the FD6288, holds three drivers: one per phase.",
    how: "The processor tells them when to switch, and they drive the MOSFETs' gates hard enough to switch quickly.",
    fails: "A failed driver looks like any other dead channel: one motor that won't run properly.",
    specs: "Dedicated gate drivers improve active braking.",
  },
  [EscPiece.Processors]: {
    name: "Processors",
    what: "The brains, each running ESC firmware. Most 4-in-1 boards have one per motor; a few use one for all four.",
    how: "It reads the flight controller's DShot commands and times the switching to keep up with the motor.",
    fails: "A desync is when its timing loses track of the motor, from very high RPM or from damage.",
    specs: "Its firmware: Bluejay (on BLHeli_S hardware) or AM32. Both support bidirectional DShot for RPM filtering.",
  },
  [EscPiece.CurrentSensor]: {
    name: "Current sensor",
    what: "Measures the current the whole board draws.",
    how: "Usually a tiny resistor with a monitor chip reading the voltage across it, reported to the flight "
      + "controller.",
    fails: "Readings are only as good as the scale set in the flight controller, so check them against a charger.",
    specs: "It lets the flight controller show live current and how much of the battery you have used.",
  },
  [EscPiece.FcConnector]: {
    name: "FC connector",
    what: "The socket for the cable to the flight controller: battery voltage, ground, current, often telemetry, and "
      + "four motor signals.",
    how: "Motor commands come in from the flight controller; voltage, current and telemetry go back out.",
    fails: "Pinouts differ between brands. A mismatched cable can put battery voltage on a signal pin and kill both "
      + "boards.",
    specs: "Compare both boards' pinouts before connecting, and re-pin the cable if they differ.",
  },
  [EscPiece.MotorPads]: {
    name: "Motor pads",
    what: "Three pads per motor, one for each of its wires.",
    how: "The wires can go on in any order. Swapping two reverses the motor, and so does a setting.",
    fails: "A broken or loose joint stops the motor or makes it stutter.",
    specs: "Their positions decide how neatly the motor wires reach them along the arms.",
  },
  [EscPiece.BatteryPads]: {
    name: "Battery pads",
    what: "Where battery power comes in, through thick silicone leads from the battery connector.",
    how: "All four motors' current flows through them, more than anywhere else on the quad.",
    fails: "Cracked or cold solder joints here are a common fault. Reversed polarity can destroy the board.",
    specs: "Positive to positive and negative to negative, checked before first power.",
  },
  [EscPiece.Capacitor]: {
    name: "Capacitor",
    what: "A low-ESR capacitor across the battery pads that absorbs voltage spikes and electrical noise.",
    how: "The motors and switches make sharp spikes on the battery lines. Close to the pads, the capacitor soaks them "
      + "up.",
    fails: "Without one: video noise, hot motors, harder tuning, spike damage to parts and, at worst, desyncs.",
    specs: "680 to 1000 µF for 5 inch, rated 1.5 to 2 times the battery voltage. The longer leg is positive.",
  },
  [EscPiece.Grommets]: {
    name: "Grommets",
    what: "Rubber rings in the mounting holes that soft-mount the stack.",
    how: "They damp vibration from the frame before it reaches the flight controller's gyro.",
    fails: "Squashed by overtightened screws, they stop damping.",
    specs: "They mostly matter for the flight controller. Many ESCs are fine mounted hard.",
  },
};
