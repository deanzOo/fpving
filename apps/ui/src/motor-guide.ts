import { MotorPiece } from "./motor-model.ts";

/** What the atlas says about a part or piece. */
export interface PartGuide {
  readonly name: string;
  readonly what: string;
  readonly how: string;
  readonly fails: string;
  readonly specs: string;
}

/** What the atlas says about the whole motor. */
export const MOTOR_GUIDE: PartGuide = {
  name: "Brushless motor",
  what: "Turns battery power from the ESC into thrust at the prop. On this outrunner design the outside spins and the "
    + "core stays still.",
  how: "The ESC energises three sets of coils in sequence. That makes a magnetic field that moves around the stator, "
    + "and the magnets in the bell chase it.",
  fails: "Most damage comes from crashes: a bent shaft, a dented bell, or debris between the magnets and the stator.",
  specs: "2207 means a stator 22 mm wide and 7 mm tall. KV, weight and the mounting pattern come next.",
};

/** What the atlas says about each piece of the motor. */
export const MOTOR_PIECE_GUIDES: Readonly<Record<MotorPiece, PartGuide>> = {
  [MotorPiece.Nut]: {
    name: "Prop nut",
    what: "Clamps the propeller to the shaft.",
    how: "A nylon insert grips the thread so vibration doesn't loosen it. Clamping friction stops the prop slipping.",
    fails: "A loose nut can throw a prop in flight. The nylon wears out, so replace nuts that spin on easily.",
    specs: "Usually M5 on 5 inch motors. Check the thread before you buy spares.",
  },
  [MotorPiece.Shaft]: {
    name: "Shaft",
    what: "Carries the bell's turning force to the prop, and locates the rotor on the bearings.",
    how: "It is fixed to the bell and runs through both bearings, so the rotor spins around it as one piece.",
    fails: "Bends in crashes, which shows up as vibration and a wobbling prop tip. Many can be replaced.",
    specs: "Its diameter, the thread at the tip, and whether it is steel or titanium.",
  },
  [MotorPiece.Bell]: {
    name: "Bell",
    what: "The outer can that spins. It carries the magnets and the prop.",
    how: "A steel ring behind the magnets carries their field around the outside, which concentrates it across the "
      + "gap to the stator.",
    fails: "A dent or bend makes it rub the stator. Spin it by hand: it should turn freely and quietly.",
    specs: "Its weight affects how quickly the motor changes speed. Open tops cool better and let more dirt in.",
  },
  [MotorPiece.Magnets]: {
    name: "Magnets",
    what: "14 curved permanent magnets glued inside the bell, alternating north and south. Coloured here for clarity.",
    how: "The stator's moving field pulls and pushes each one. That force, acting at the rim of the bell, is the "
      + "motor's torque.",
    fails: "Crashes can crack them or break the glue. Overheating weakens them for good, which shows as lost power.",
    specs: "12N14P is the common layout: 12 stator slots and 14 magnet poles. RPM filtering needs the pole count.",
  },
  [MotorPiece.TopBearing]: {
    name: "Top bearing",
    what: "Keeps the shaft centred at the top of the base's tube, and lets it spin with little friction.",
    how: "Steel balls roll between an inner race on the shaft and an outer race in the tube.",
    fails: "Crashes and grit make it rough. Spin the bell by hand and feel for grinding.",
    specs: "Sized as outer × inner × width in mm. A replacement has to match exactly.",
  },
  [MotorPiece.Windings]: {
    name: "Windings",
    what: "Enamelled copper coils around each stator tooth, grouped into three phases.",
    how: "Current through a coil turns its tooth into an electromagnet. Switching phases moves the field around.",
    fails: "Scraped enamel can short a coil, causing heat, desyncs and burnt ESCs. Look for dark or nicked wire.",
    specs: "Fewer turns of thicker wire give a higher KV: more RPM per volt, and more current.",
  },
  [MotorPiece.Stator]: {
    name: "Stator",
    what: "The fixed iron core with 12 teeth. It concentrates the coils' field and aims it at the magnets.",
    how: "It is a stack of thin, insulated steel sheets. The layers limit the unwanted currents that would heat it.",
    fails: "Rarely fails alone. Bent teeth or debris can rub the magnets.",
    specs: "It names the motor: width then height in mm. A bigger stator can make more torque, and weighs more.",
  },
  [MotorPiece.Wires]: {
    name: "Phase wires",
    what: "The three wires from the windings to the ESC. Coloured here for clarity; real ones often look alike.",
    how: "The ESC drives them in turn. Swapping any two reverses the motor, and so does a setting in the ESC.",
    fails: "They break where they leave the motor or at the solder joint, often after a prop strike. It stutters.",
    specs: "They have to reach your ESC pads. Short wires are hard to extend neatly.",
  },
  [MotorPiece.BottomBearing]: {
    name: "Bottom bearing",
    what: "The shaft's second support. Two bearings apart keep it from tilting.",
    how: "Works like the top one. It also meets the load when thrust pulls the rotor up against the clip.",
    fails: "Roughness or a rattle are the signs, just as with the top one.",
    specs: "Often the same size as the top bearing, but not always, so check first.",
  },
  [MotorPiece.Base]: {
    name: "Base",
    what: "The part that bolts to the frame. Its central tube holds the bearings and supports the stator.",
    how: "It stays still and carries the thrust and the motor's reaction force into the arm.",
    fails: "Screws that are too long reach the windings and short the motor, a classic first-build mistake.",
    specs: "The bolt pattern must match your frame: usually 16×16 mm with M3 screws at this size.",
  },
  [MotorPiece.Clip]: {
    name: "Retaining clip",
    what: "A small C-shaped clip in a groove at the bottom of the shaft. It keeps the rotor on the motor.",
    how: "The magnets pull the bell down, and thrust pulls it up in flight. The clip stops it lifting off.",
    fails: "Lost in a crash, it can let the bell leave the motor in flight. Check it is seated, and keep spares.",
    specs: "Sized to the shaft, and usually included with spare shaft kits.",
  },
};
