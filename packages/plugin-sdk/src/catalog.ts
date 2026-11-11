import { z } from "zod";
import type { Clock, Logger } from "./context.js";
import { gearSpecsSchema } from "./gear.js";
import { manifestSchema } from "./manifest.js";
import type { Result } from "./result.js";

/** The kinds of plugin the host loads. A manifest without a `kind` is a store plugin. */
export const PluginKind = {
  Catalog: "catalog",
} as const;

/** One of the {@link PluginKind} values. */
export type PluginKind = (typeof PluginKind)[keyof typeof PluginKind];

/**
 * Validates the `manifest` a catalog plugin exports. Its `id`, `displayName`, `version` and `sdkVersion` follow the
 * same rules as {@link manifestSchema}; it has no `domains` or `capabilities`, and any extra field is rejected.
 */
export const catalogManifestSchema = z.strictObject({
  kind: z.literal(PluginKind.Catalog),
  id: manifestSchema.shape.id,
  displayName: manifestSchema.shape.displayName,
  version: manifestSchema.shape.version,
  sdkVersion: manifestSchema.shape.sdkVersion,
});

/** A catalog plugin manifest as {@link catalogManifestSchema} accepts it. */
export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

/** Validates one piece of known gear a catalog returns: a stable `key` within the catalog, a name and its specs. */
export const catalogEntrySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  specs: gearSpecsSchema,
});

/** A catalog entry as {@link catalogEntrySchema} accepts it. */
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

/**
 * Why a catalog call failed.
 *
 * @remarks
 * - `failed`: the catalog could not answer.
 */
export const CatalogErrorKind = {
  Failed: "failed",
} as const;

/** One of the {@link CatalogErrorKind} values. */
export type CatalogErrorKind = (typeof CatalogErrorKind)[keyof typeof CatalogErrorKind];

/** A catalog error. `detail` is a human-readable reason for logs. */
export interface CatalogError {
  /** What went wrong. */
  readonly kind: CatalogErrorKind;
  /** Human-readable reason for logs. */
  readonly detail: string;
}

/** Everything the host gives a catalog. */
export interface CatalogContext {
  /** Structured logger. */
  readonly logger: Logger;
  /** The host clock. */
  readonly clock: Clock;
}

/** A bundle of known gear. Methods resolve to a `Result` and never reject. */
export interface Catalog {
  /** Entries whose name matches the text. */
  search(text: string): Promise<Result<CatalogEntry[], CatalogError>>;
  /** The entry with this key, or `null` when the catalog has none. */
  get(key: string): Promise<Result<CatalogEntry | null, CatalogError>>;
}

/** What a catalog plugin module exports. */
export interface CatalogPlugin {
  /** The validated manifest. */
  readonly manifest: CatalogManifest;
  /** Builds the catalog the host will query. */
  createCatalog(ctx: CatalogContext): Catalog;
}
