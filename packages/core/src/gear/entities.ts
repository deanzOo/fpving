import { GearKind, gearSpecsSchema } from "@fpving/plugin-sdk";
import { z } from "zod";
import { gearItemIdSchema, pluginIdSchema } from "../ids.js";
import { textSchema } from "../text.js";

/** Where a stored spec value came from: a catalog plugin, or the user who confirmed it. */
export const SpecSource = { Catalog: "catalog", User: "user" } as const;

/** One of the {@link SpecSource} values. */
export type SpecSource = (typeof SpecSource)[keyof typeof SpecSource];

/** Accepts one spec value together with its source; a catalog source names the plugin. */
export const specValueSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal(SpecSource.Catalog), pluginId: pluginIdSchema, value: z.json() }),
  z.object({ source: z.literal(SpecSource.User), value: z.json() }),
]);

/** A spec value as {@link specValueSchema} accepts it. */
export type SpecValue = z.infer<typeof specValueSchema>;

interface StoredSpecs {
  readonly kind: GearKind;
  readonly specs: Readonly<Record<string, SpecValue>>;
}

const stripSources = (item: StoredSpecs): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(item.specs).map(([field, spec]) => [field, spec.value])),
  kind: item.kind,
});

/** Accepts gear the user owns. Its specs, with their sources stripped, must satisfy `gearSpecsSchema`. */
export const gearItemSchema = z
  .object({
    id: gearItemIdSchema,
    kind: z.enum(GearKind),
    name: textSchema,
    quantity: z.int().positive(),
    createdAt: z.date(),
    catalogRef: z.object({ pluginId: pluginIdSchema, key: z.string().min(1) }).nullable(),
    specs: z.record(z.string(), specValueSchema),
  })
  .refine((item) => gearSpecsSchema.safeParse(stripSources(item)).success, {
    message: "specs must satisfy the gear spec vocabulary of the item's kind",
    path: ["specs"],
  });

/** A gear item as {@link gearItemSchema} accepts it. */
export type GearItem = z.infer<typeof gearItemSchema>;

const KIND_ORDER: readonly string[] = Object.values(GearKind);

/** Orders gear by kind in `GearKind` declaration order, then by name with `localeCompare`. */
export const compareGear = (a: GearItem, b: GearItem): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);
