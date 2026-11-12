import {
  Chemistry, Connector, GearKind, gearSpecsSchema, RadioFirmware, RcLink, SizeClass, ToolType, VideoSystem,
} from "@fpving/plugin-sdk";
import type { GearSpecField } from "@fpving/plugin-sdk";
import { z } from "zod";

type Json = z.core.util.JSONType;
type Words = Readonly<Record<string, string>>;

/** A kind of gear as one item of it is called. */
export const KIND_LABEL = {
  [GearKind.Radio]: "Radio",
  [GearKind.Goggles]: "Goggles",
  [GearKind.Quad]: "Quad",
  [GearKind.Battery]: "Battery",
  [GearKind.Charger]: "Charger",
  [GearKind.Tool]: "Tool",
} as const satisfies Record<GearKind, string>;

/** A kind of gear as the heading over all of it. */
export const KIND_HEADING = {
  [GearKind.Radio]: "Radios",
  [GearKind.Goggles]: "Goggles",
  [GearKind.Quad]: "Quads",
  [GearKind.Battery]: "Batteries",
  [GearKind.Charger]: "Chargers",
  [GearKind.Tool]: "Tools",
} as const satisfies Record<GearKind, string>;

const RC_LINK = {
  [RcLink.Elrs2g4]: "ELRS 2.4GHz",
  [RcLink.Elrs900]: "ELRS 900MHz",
  [RcLink.Crossfire]: "Crossfire",
  [RcLink.Tracer]: "Tracer",
  [RcLink.FrskyD16]: "FrSky D16",
  [RcLink.Other]: "Other link",
} as const satisfies Record<RcLink, string>;

const FIRMWARE = {
  [RadioFirmware.EdgeTx]: "EdgeTX",
  [RadioFirmware.OpenTx]: "OpenTX",
  [RadioFirmware.Other]: "Other firmware",
} as const satisfies Record<RadioFirmware, string>;

const VIDEO = {
  [VideoSystem.Analog5g8]: "Analog 5.8GHz",
  [VideoSystem.DjiO3]: "DJI O3",
  [VideoSystem.DjiO4]: "DJI O4",
  [VideoSystem.Walksnail]: "Walksnail",
  [VideoSystem.HdZero]: "HDZero",
} as const satisfies Record<VideoSystem, string>;

const CONNECTOR = {
  [Connector.Bt2]: "BT2.0",
  [Connector.Ph2]: "PH2.0",
  [Connector.Xt30]: "XT30",
  [Connector.Xt60]: "XT60",
  [Connector.Other]: "Other connector",
} as const satisfies Record<Connector, string>;

const CHEMISTRY = {
  [Chemistry.Lipo]: "LiPo",
  [Chemistry.Lihv]: "LiHV",
  [Chemistry.LiIon]: "Li-ion",
} as const satisfies Record<Chemistry, string>;

const TOOL = {
  [ToolType.SolderingIron]: "Soldering iron",
  [ToolType.Multimeter]: "Multimeter",
  [ToolType.SmokeStopper]: "Smoke stopper",
  [ToolType.HexDrivers]: "Hex drivers",
  [ToolType.PrecisionKit]: "Precision kit",
  [ToolType.EsdMat]: "Anti-static mat",
  [ToolType.Tweezers]: "Tweezers",
  [ToolType.Other]: "Other tool",
} as const satisfies Record<ToolType, string>;

const SIZE = {
  [SizeClass.Whoop65]: "65mm whoop",
  [SizeClass.Whoop75]: "75mm whoop",
  [SizeClass.TwoPointFiveInch]: "2.5 inch",
  [SizeClass.ThreeInch]: "3 inch",
  [SizeClass.ThreePointFiveInch]: "3.5 inch",
  [SizeClass.FiveInch]: "5 inch",
  [SizeClass.Other]: "Other size",
} as const satisfies Record<SizeClass, string>;

type SpecField = { [K in GearKind]: GearSpecField<K> }[GearKind];

const choice = (label: string, words: Words) => ({ label, words, count: null });
const count = (label: string, unit: (value: number) => string) => ({ label, words: null, count: unit });

const FIELD = {
  rcLink: choice("Radio link", RC_LINK),
  firmware: choice("Firmware", FIRMWARE),
  videoSystems: choice("Video systems", VIDEO),
  channels: count("Channels", (value) => `${String(value)} ch`),
  sizeClass: choice("Size", SIZE),
  cells: count("Cells", (value) => `${String(value)}S`),
  connector: choice("Connector", CONNECTOR),
  videoSystem: choice("Video system", VIDEO),
  chemistry: choice("Chemistry", CHEMISTRY),
  capacityMah: count("Capacity (mAh)", (value) => `${String(value)}mAh`),
  connectors: choice("Connectors", CONNECTOR),
  ports: count("Ports", (value) => `${String(value)} ports`),
  toolType: choice("Tool type", TOOL),
} as const satisfies Record<SpecField, ReturnType<typeof choice> | ReturnType<typeof count>>;

const isSpecField = (field: string): field is SpecField => Object.hasOwn(FIELD, field);

/** One spec field of a kind: its name, label, its schema and, for a closed set, the words of its values. */
export interface GearField {
  readonly name: SpecField;
  readonly label: string;
  readonly list: boolean;
  readonly words: Words | null;
  readonly schema: z.core.$ZodType;
}

const fieldsOf = (shape: Readonly<Record<string, z.ZodExactOptional>>): readonly GearField[] => Object.entries(shape)
  .filter((entry): entry is [SpecField, z.ZodExactOptional] => isSpecField(entry[0]))
  .map(([name, optional]) => {
    const schema = optional.unwrap();
    return { name, label: FIELD[name].label, list: schema instanceof z.ZodArray, words: FIELD[name].words, schema };
  });

const [RADIO, GOGGLES, QUAD, BATTERY, CHARGER, TOOL_SPECS] = gearSpecsSchema.options;

/** The spec fields of each kind, in the order the vocabulary declares them. */
export const GEAR_FIELDS = {
  [GearKind.Radio]: fieldsOf(RADIO.omit({ kind: true }).shape),
  [GearKind.Goggles]: fieldsOf(GOGGLES.omit({ kind: true }).shape),
  [GearKind.Quad]: fieldsOf(QUAD.omit({ kind: true }).shape),
  [GearKind.Battery]: fieldsOf(BATTERY.omit({ kind: true }).shape),
  [GearKind.Charger]: fieldsOf(CHARGER.omit({ kind: true }).shape),
  [GearKind.Tool]: fieldsOf(TOOL_SPECS.omit({ kind: true }).shape),
} as const satisfies Record<GearKind, readonly GearField[]>;

const isCount = (value: Json): value is number => typeof value === "number";

/**
 * The words of a spec value, one per value of a list: the label of a closed-set value, a count with its unit. A value
 * outside the vocabulary has no word.
 */
export const specWords = (field: SpecField, value: Json): string[] => {
  const entry = FIELD[field];
  const values = [value].flat();
  return entry.words === null
    ? values.filter(isCount).map((item) => entry.count(item))
    : values.flatMap((item) => Object.entries(entry.words).filter(([key]) => key === item).map(([, word]) => word));
};
