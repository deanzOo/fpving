import { FcPiece } from "./fc-model.ts";
import type { PartGuide } from "./motor-guide.ts";

/** What the atlas says about the whole flight controller. */
export const FC_GUIDE: PartGuide = {
  name: "Flight controller",
  what: "The quad's brain. It reads the gyro and the receiver, and tells each motor through the ESC how fast to spin.",
  how: "Thousands of times a second it compares how the quad is turning with what the sticks ask for, and corrects "
    + "the motors to match.",
  fails: "Mixing brands with the ESC is a common trap: the cable can fit while the pinout differs, and the wrong pin "
    + "can kill a board on first power.",
  specs: "Mounting size, processor, gyro and enough UARTs. Three suit most freestyle builds: a receiver, a digital "
    + "VTX and GPS.",
};

/** What the atlas says about each piece of the flight controller. */
export const FC_PIECE_GUIDES: Readonly<Record<FcPiece, PartGuide>> = {
  [FcPiece.Board]: {
    name: "Board",
    what: "The circuit board, stacked above the ESC on the same four screws.",
    how: "Copper on and inside it carries power from the regulators and signals between the chips and pads.",
    fails: "A loose wire or a screw touching a pad can short it on power up.",
    specs: "30.5×30.5 mm holes on most 5 inch builds, 20×20 on 3 to 4 inch. Check the board's own size too: some "
      + "reach past their holes.",
  },
  [FcPiece.Processor]: {
    name: "Processor",
    what: "The chip that runs the firmware, Betaflight or iNav. Its family is often in the board's name: F4, F7 or H7.",
    how: "It runs the flight loop and talks to the receiver, VTX and GPS over its UARTs.",
    fails: "Firmware built for another board's target can leave parts not working. Flash the target made for yours.",
    specs: "A faster processor does not make the quad fly much better. Enough UARTs matter more for most builds.",
  },
  [FcPiece.Gyro]: {
    name: "Gyro",
    what: "The motion sensor, or IMU. It measures how fast the quad is turning on every axis.",
    how: "The processor reads it thousands of times a second to keep the quad steady.",
    fails: "\"No gyro detected\" can mean the wrong firmware. If a clean reflash does not fix it, the chip may be "
      + "faulty.",
    specs: "The ICM-42688-P is common and recommended for new designs; the MPU6000 is no longer made. The CLI's "
      + "status command names yours.",
  },
  [FcPiece.Osd]: {
    name: "OSD chip",
    what: "Puts text over analog video: battery voltage, flight time and warnings.",
    how: "It writes the flight controller's data onto the camera's picture on its way to the video transmitter.",
    fails: "Some boards made for digital video leave it out, so an analog build on one has no OSD.",
    specs: "Usually an AT7456E. Digital systems do not need it: they take OSD data over a UART.",
  },
  [FcPiece.Flash]: {
    name: "Blackbox flash",
    what: "A memory chip that records flight data.",
    how: "It logs the gyro, sticks and motors, to read back on a computer.",
    fails: "A small chip fills quickly, and logging stops when it is full. Erase it before a tuning session.",
    specs: "Even a small one is useful for troubleshooting and for tuning PIDs and filters.",
  },
  [FcPiece.Regulators]: {
    name: "Regulators",
    what: "Turn battery voltage into steady supplies: 5V for the receiver and GPS, 9V or 12V for a digital VTX.",
    how: "Each regulator, or BEC, feeds its own set of pads.",
    fails: "A burnt 5V regulator is a common fault: the board starts on USB but not on the battery.",
    specs: "Check current as well as voltage: a 9V supply rated 1A may not power every digital VTX.",
  },
  [FcPiece.UsbPort]: {
    name: "USB port",
    what: "Connects the board to a computer, to set it up and flash its firmware.",
    how: "It also powers the board's 4.5V pads, so the receiver and GPS can be set up without a battery.",
    fails: "Ports break off in crashes and rough handling, often tearing their tiny pads with them.",
    specs: "USB-C is easier to live with than micro USB. It must still be reachable once the board is in the frame.",
  },
  [FcPiece.BootButton]: {
    name: "Boot button",
    what: "Starts the processor in DFU mode, which is how new firmware gets flashed.",
    how: "Hold it down while plugging in the USB cable.",
    fails: "It can be hard to reach once the board is in a frame. The CLI command bl gets into DFU mode without it.",
    specs: "Boards without one have two boot pads to bridge instead.",
  },
  [FcPiece.EscConnector]: {
    name: "ESC connector",
    what: "The socket for the cable to the ESC: battery voltage, ground, current, telemetry and four motor signals.",
    how: "Motor commands go out to the ESC; voltage, current and telemetry come back.",
    fails: "A cable from another brand can fit while the pinout differs, and the wrong pin can damage a board when "
      + "the battery goes in.",
    specs: "Matched stacks come with the right cable. Mixing brands, compare both pinouts and re-pin it if they "
      + "differ.",
  },
  [FcPiece.Pads]: {
    name: "Solder pads",
    what: "Labelled pads around the edge for the receiver, video, GPS, buzzer and LEDs.",
    how: "Each UART is a TX and RX pair, wired crosswise: the board's TX to the device's RX.",
    fails: "Too much heat for too long can rip a pad off the board.",
    specs: "Layouts differ between boards, so wire from your board's own diagram.",
  },
  [FcPiece.Grommets]: {
    name: "Grommets",
    what: "Rubber rings in the mounting holes that the board sits on.",
    how: "They soak up motor vibration before it reaches the gyro.",
    fails: "Squashed by overtightened nuts, they stop damping.",
    specs: "Keep the screws and nuts clear of any exposed pads.",
  },
};
