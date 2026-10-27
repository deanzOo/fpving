import { manifestSchema } from "@fpving/plugin-sdk";
import { z } from "zod";

/** Accepts a non-empty string as the id of a product. Ids come from an `IdGenerator`. */
export const productIdSchema = z.string().min(1).brand<"ProductId">();

/** A product id as {@link productIdSchema} accepts it. */
export type ProductId = z.infer<typeof productIdSchema>;

/** Accepts a non-empty string as the id of a listing. */
export const listingIdSchema = z.string().min(1).brand<"ListingId">();

/** A listing id as {@link listingIdSchema} accepts it. */
export type ListingId = z.infer<typeof listingIdSchema>;

/** Accepts a non-empty string as the id of a price snapshot. */
export const snapshotIdSchema = z.string().min(1).brand<"SnapshotId">();

/** A snapshot id as {@link snapshotIdSchema} accepts it. */
export type SnapshotId = z.infer<typeof snapshotIdSchema>;

/** Accepts a non-empty string as the id of a match candidate. */
export const matchCandidateIdSchema = z.string().min(1).brand<"MatchCandidateId">();

/** A match candidate id as {@link matchCandidateIdSchema} accepts it. */
export type MatchCandidateId = z.infer<typeof matchCandidateIdSchema>;

/** Accepts a non-empty string as the id of an alert. */
export const alertIdSchema = z.string().min(1).brand<"AlertId">();

/** An alert id as {@link alertIdSchema} accepts it. */
export type AlertId = z.infer<typeof alertIdSchema>;

/** Accepts a non-empty string as the id of a scan run. */
export const scanRunIdSchema = z.string().min(1).brand<"ScanRunId">();

/** A scan run id as {@link scanRunIdSchema} accepts it. */
export type ScanRunId = z.infer<typeof scanRunIdSchema>;

/** Accepts a plugin id the way a manifest does, so the manifest's `id` is the one source of the id rules. */
export const pluginIdSchema = manifestSchema.shape.id.brand<"PluginId">();

/** A plugin id as {@link pluginIdSchema} accepts it. */
export type PluginId = z.infer<typeof pluginIdSchema>;
