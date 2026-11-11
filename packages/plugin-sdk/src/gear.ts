import { z } from "zod";

/** What a piece of gear is. */
export const GearKind = {
  Radio: "radio",
  Goggles: "goggles",
  Quad: "quad",
  Battery: "battery",
  Charger: "charger",
  Tool: "tool",
} as const;

/** One of the {@link GearKind} values. */
export type GearKind = (typeof GearKind)[keyof typeof GearKind];

/** The link a radio, receiver or quad speaks to control the quad. */
export const RcLink = {
  Elrs2g4: "elrs-2g4",
  Elrs900: "elrs-900",
  Crossfire: "crossfire",
  Tracer: "tracer",
  FrskyD16: "frsky-d16",
  Other: "other",
} as const;

/** One of the {@link RcLink} values. */
export type RcLink = (typeof RcLink)[keyof typeof RcLink];

/** The firmware a radio runs. */
export const RadioFirmware = {
  EdgeTx: "edgetx",
  OpenTx: "opentx",
  Other: "other",
} as const;

/** One of the {@link RadioFirmware} values. */
export type RadioFirmware = (typeof RadioFirmware)[keyof typeof RadioFirmware];

/** The video link between a quad's camera and goggles. */
export const VideoSystem = {
  Analog5g8: "analog-5g8",
  DjiO3: "dji-o3",
  DjiO4: "dji-o4",
  Walksnail: "walksnail",
  HdZero: "hdzero",
} as const;

/** One of the {@link VideoSystem} values. */
export type VideoSystem = (typeof VideoSystem)[keyof typeof VideoSystem];

/** A power connector. */
export const Connector = {
  Bt2: "bt2",
  Ph2: "ph2",
  Xt30: "xt30",
  Xt60: "xt60",
  Other: "other",
} as const;

/** One of the {@link Connector} values. */
export type Connector = (typeof Connector)[keyof typeof Connector];

/** A battery chemistry. */
export const Chemistry = {
  Lipo: "lipo",
  Lihv: "lihv",
  LiIon: "li-ion",
} as const;

/** One of the {@link Chemistry} values. */
export type Chemistry = (typeof Chemistry)[keyof typeof Chemistry];

/** The type of a tool. */
export const ToolType = {
  SolderingIron: "soldering-iron",
  Multimeter: "multimeter",
  SmokeStopper: "smoke-stopper",
  HexDrivers: "hex-drivers",
  PrecisionKit: "precision-kit",
  EsdMat: "esd-mat",
  Tweezers: "tweezers",
  Other: "other",
} as const;

/** One of the {@link ToolType} values. */
export type ToolType = (typeof ToolType)[keyof typeof ToolType];

/** The size class of a quad. */
export const SizeClass = {
  Whoop65: "whoop-65",
  Whoop75: "whoop-75",
  TwoPointFiveInch: "2.5in",
  ThreeInch: "3in",
  ThreePointFiveInch: "3.5in",
  FiveInch: "5in",
  Other: "other",
} as const;

/** One of the {@link SizeClass} values. */
export type SizeClass = (typeof SizeClass)[keyof typeof SizeClass];

const count = z.number().int().positive();

const uniqueList = <T extends z.ZodType>(item: T) =>
  z.array(item).nonempty().refine((list) => new Set(list).size === list.length, "must not repeat a value");

/**
 * Validates what is known about a piece of gear, as a union on `kind`. Each kind is a strict object, so a field of
 * another kind is rejected, and every spec field is optional: a missing field means unknown.
 *
 * @remarks
 * - `cells`, `channels`, `ports` and `capacityMah` are positive integers.
 * - List fields are non-empty and hold no repeated value.
 */
export const gearSpecsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(GearKind.Radio),
    rcLink: z.enum(RcLink).exactOptional(),
    firmware: z.enum(RadioFirmware).exactOptional(),
  }),
  z.strictObject({
    kind: z.literal(GearKind.Goggles),
    videoSystems: uniqueList(z.enum(VideoSystem)).exactOptional(),
    channels: count.exactOptional(),
  }),
  z.strictObject({
    kind: z.literal(GearKind.Quad),
    sizeClass: z.enum(SizeClass).exactOptional(),
    cells: count.exactOptional(),
    connector: z.enum(Connector).exactOptional(),
    rcLink: z.enum(RcLink).exactOptional(),
    videoSystem: z.enum(VideoSystem).exactOptional(),
  }),
  z.strictObject({
    kind: z.literal(GearKind.Battery),
    cells: count.exactOptional(),
    chemistry: z.enum(Chemistry).exactOptional(),
    capacityMah: count.exactOptional(),
    connector: z.enum(Connector).exactOptional(),
  }),
  z.strictObject({
    kind: z.literal(GearKind.Charger),
    cells: uniqueList(count).exactOptional(),
    connectors: uniqueList(z.enum(Connector)).exactOptional(),
    ports: count.exactOptional(),
  }),
  z.strictObject({
    kind: z.literal(GearKind.Tool),
    toolType: z.enum(ToolType).exactOptional(),
  }),
]);

/** Gear specs as {@link gearSpecsSchema} accepts them. */
export type GearSpecs = z.infer<typeof gearSpecsSchema>;

/** The spec field names of one {@link GearKind}. */
export type GearSpecField<K extends GearKind> = Exclude<keyof Extract<GearSpecs, { kind: K }>, "kind">;
