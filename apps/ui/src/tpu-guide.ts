import type { PartGuide } from "./motor-guide.ts";
import { TpuPiece } from "./tpu-model.ts";

/** What the atlas says about printed TPU parts as a whole. */
export const TPU_GUIDE: PartGuide = {
  name: "TPU parts",
  what: "Mounts, guards and covers 3D printed in TPU, a flexible, rubber-like plastic.",
  how: "TPU bends and springs back, so it soaks up crashes that would crack a rigid part, and protects what it holds.",
  fails: "TPU is too flexible for anything that must hold firm: rigid parts are better printed in PETG.",
  specs: "Many frames come with a set, and files for most are free to download and print. Keep the filament dry.",
};

/** What the atlas says about each printed part. */
export const TPU_PIECE_GUIDES: Readonly<Record<TpuPiece, PartGuide>> = {
  [TpuPiece.Canopy]: {
    name: "Canopy",
    what: "A printed cover over the top of the stack or the air unit.",
    how: "It keeps grass, dirt and crash impacts off the electronics underneath.",
    fails: "A tight cover with no gaps can trap heat around an air unit.",
    specs: "It must fit your exact frame and what is under it.",
  },
  [TpuPiece.GoproMount]: {
    name: "GoPro mount",
    what: "Holds an action camera on top of the quad.",
    how: "The camera's prongs slot between its fins, held by a long screw, and the TPU takes some of the crash.",
    fails: "The camera's weight swings in a crash, and a worn mount can let it go.",
    specs: "Its angle sets how the footage looks: match it roughly to the FPV camera's tilt.",
  },
  [TpuPiece.CameraMount]: {
    name: "Camera mount",
    what: "Holds the FPV camera and lets its angle be set.",
    how: "The camera sits between its sides, which take knocks before the lens does.",
    fails: "Too soft or too thin, it lets the camera shake, which shows in the picture.",
    specs: "It must suit the camera's size: micro cameras are 19 mm wide.",
  },
  [TpuPiece.AntennaMount]: {
    name: "Antenna mount",
    what: "Holds an antenna up at the back of the quad.",
    how: "It keeps the antenna in a good position, clear of the props, and protects it.",
    fails: "An antenna that droops or turns can end up in the props or behind carbon.",
    specs: "Print it for your antenna's connector and the frame's mounting holes.",
  },
  [TpuPiece.ArmGuard]: {
    name: "Arm guard",
    what: "A clip over the end of an arm.",
    how: "It takes the hit when the quad lands on its arms, and protects the carbon.",
    fails: "Guards wear through over time, and are cheap to reprint.",
    specs: "It must match the arm's width and thickness.",
  },
  [TpuPiece.Xt60Holder]: {
    name: "XT60 holder",
    what: "Holds the quad's XT60 connector firmly in place.",
    how: "Plugging and unplugging the battery pulls on it, not on the ESC's solder joints.",
    fails: "Without one, a flapping connector strains its leads every flight.",
    specs: "Sized for an XT60, which is about 16 by 8 mm.",
  },
};
