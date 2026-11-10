import type { PartGuide } from "./motor-guide.ts";
import { AnalogPiece, DigitalPiece } from "./video-model.ts";

/** What the atlas says about the whole analog video system. */
export const ANALOG_GUIDE: PartGuide = {
  name: "Analog video",
  what: "A camera and a video transmitter, or VTX, sending a live picture to your goggles on a 5.8GHz channel.",
  how: "The camera's picture goes through the flight controller, which lays the OSD over it, then on to the VTX and "
    + "out of the antenna.",
  fails: "Powering a VTX without its antenna can permanently damage it.",
  specs: "Camera size and sensor, VTX power, and antennas whose polarisation matches the goggles'.",
};

/** What the atlas says about each piece of the analog video system. */
export const ANALOG_PIECE_GUIDES: Readonly<Record<AnalogPiece, PartGuide>> = {
  [AnalogPiece.Camera]: {
    name: "Camera",
    what: "A micro camera, 19 mm wide: the most popular size for 3 to 5 inch frames.",
    how: "Its sensor turns the view into an analog video signal. Most now use CMOS, which has caught up with CCD.",
    fails: "CMOS sensors have a rolling shutter, which makes them more prone to jello from vibration.",
    specs: "Sensor size and WDR, for detail in shadows and bright sky at once. Many run on anything from 5V to the "
      + "battery.",
  },
  [AnalogPiece.Lens]: {
    name: "Lens",
    what: "Screws into the camera and sets how wide it sees.",
    how: "A shorter focal length sees wider: on a 1/3 inch sensor, 1.8 mm gives about 160 to 170°, 2.1 mm about 150 "
      + "to 160°.",
    fails: "If its aspect ratio, 4:3 or 16:9, does not match the goggles', the picture looks stretched.",
    specs: "M12 lenses let in a little more light than smaller M8 ones.",
  },
  [AnalogPiece.Vtx]: {
    name: "VTX",
    what: "The video transmitter: a small board that sends the picture out on a 5.8GHz channel.",
    how: "The flight controller sets its channel and power over SmartAudio or Tramp, wired to a spare UART.",
    fails: "It runs hot at high power. Setting low power while disarmed helps keep it cool.",
    specs: "Output power from 25mW up. The OSD shows it as levels 1 to 5, not milliwatts.",
  },
  [AnalogPiece.Button]: {
    name: "Button",
    what: "Changes band, channel and power by hand.",
    how: "Most builds set the VTX from the goggles' OSD menu instead, through the flight controller.",
    fails: "Changes made with the button may not reach the flight controller, so the OSD can show the old setting.",
    specs: "Pit mode drops it to minimum power, so it does not interfere with other pilots after a crash.",
  },
  [AnalogPiece.Pigtail]: {
    name: "Pigtail",
    what: "A short cable from the VTX's tiny antenna socket to a sturdy SMA connector held by the frame.",
    how: "The VTX end clips on with u.FL, also called IPEX, or MMCX.",
    fails: "u.FL clips are small and can pop off in a crash, leaving the VTX with no antenna.",
    specs: "SMA and RP-SMA look alike, but do not fit each other.",
  },
  [AnalogPiece.Antenna]: {
    name: "Antenna",
    what: "A circularly polarised lollipop antenna.",
    how: "It sends the VTX's signal out; the goggles' antenna picks it up.",
    fails: "Never power the VTX without it: with nowhere to go, the power can permanently damage the VTX.",
    specs: "Its polarisation, RHCP or LHCP, should match the goggles' antennas.",
  },
  [AnalogPiece.Wires]: {
    name: "Wires",
    what: "Three wires on the camera: video, power and ground. The VTX adds one for SmartAudio or Tramp.",
    how: "Both usually connect to the flight controller, which adds the OSD between camera and VTX.",
    fails: "Interference and noise in the picture often trace back to wiring and grounds.",
    specs: "Wire from your boards' own diagrams: pad layouts differ.",
  },
};

/** What the atlas says about the whole digital video system. */
export const DIGITAL_GUIDE: PartGuide = {
  name: "Digital video",
  what: "A camera and an air unit sending HD video to digital goggles, from DJI, Walksnail or HDZero.",
  how: "The air unit turns the camera's picture into data and sends it to the goggles. The OSD comes from the flight "
    + "controller over a UART.",
  fails: "Air units get hot fast on the bench without airflow, and shut down to protect themselves.",
  specs: "The system first, since the goggles must match it: DJI, Walksnail and HDZero do not work with each other.",
};

/** What the atlas says about each piece of the digital video system. */
export const DIGITAL_PIECE_GUIDES: Readonly<Record<DigitalPiece, PartGuide>> = {
  [DigitalPiece.Camera]: {
    name: "Camera",
    what: "The camera and lens, made for one air unit.",
    how: "It hands its picture to the air unit over a thin cable.",
    fails: "Cameras are tied to their air unit's generation: an O4 camera cable does not fit an O3.",
    specs: "Sensor size: the O4 Lite's smaller 1/2 inch sensor does worse in low light than the O4 Pro's.",
  },
  [DigitalPiece.CameraCable]: {
    name: "Camera cable",
    what: "A thin coaxial cable from the camera to the air unit.",
    how: "It carries the camera's picture at full resolution.",
    fails: "Pressing on or bending its base can interrupt or degrade the picture.",
    specs: "Lengths and plugs differ between systems and generations, so buy the one made for yours.",
  },
  [DigitalPiece.AirUnit]: {
    name: "Air unit",
    what: "The digital transmitter, with its own processor.",
    how: "It compresses the picture, sends it to the goggles and can record it in high quality onboard.",
    fails: "Overheating cuts its frame rate and range, then it shuts itself down.",
    specs: "Power it from a supply that can keep up: an O4 Lite wants a BEC of at least 5V 2A or 9V 1A.",
  },
  [DigitalPiece.Heatsink]: {
    name: "Heatsink",
    what: "Metal fins that carry heat away from the air unit.",
    how: "Air flowing over it in flight does the cooling. On the bench there is none.",
    fails: "Without one, an air unit gets uncomfortably hot within half a minute on the bench.",
    specs: "Units without one, like the O4 Lite, are limited to lower transmit power.",
  },
  [DigitalPiece.Antennas]: {
    name: "Antennas",
    what: "One or two antennas on thin u.FL leads.",
    how: "They send the video to the goggles.",
    fails: "Never power the air unit without them: the transmitter can be permanently damaged.",
    specs: "The O4 Pro uses two, the O4 Lite one.",
  },
  [DigitalPiece.FcCable]: {
    name: "FC cable",
    what: "Power, ground and a UART pair to the flight controller.",
    how: "The UART carries the flight controller's OSD to the goggles.",
    fails: "TX must go to RX and RX to TX. Wired straight across, there is no OSD.",
    specs: "Use a spare UART, and a power pad that can supply enough current.",
  },
};
