import { z } from "zod";
import { isSemverRange, isSemverVersion } from "./semver.js";

/**
 * What a store plugin can do. The host only calls a capability the manifest declares.
 *
 * @remarks
 * - `fetchListing`: fetch one product page and return its price, shipping and stock. Every store implements it.
 * - `search`: search the store for candidate listings; the store must then implement {@link Store.search}.
 * - `shippingToCountry`: prices include shipping to the context's `shipTo` country.
 */
export const PluginCapability = {
  FetchListing: "fetchListing",
  Search: "search",
  ShippingToCountry: "shippingToCountry",
} as const;

/** One of the {@link PluginCapability} values. */
export type PluginCapability = (typeof PluginCapability)[keyof typeof PluginCapability];

/** The longest plugin id the manifest accepts. */
export const MAX_ID_LENGTH = 64;

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Validates the `manifest` a plugin exports. The host refuses to load a plugin whose manifest fails this schema.
 *
 * @remarks
 * - `id`: stable identifier of lowercase letters and digits in hyphen-separated words, such as `example-shop`, at
 *   most {@link MAX_ID_LENGTH} characters.
 * - `version`: the plugin's own canonical semver version, such as `1.2.3` or `1.2.3+build.1`.
 * - `sdkVersion`: the semver range of this SDK the plugin was tested against, such as `>=0.0.0 <1.0.0`. Unbounded
 *   ranges (`*`, `x`, `>=0.0.0`) are rejected.
 * - `domains`: lowercase hostnames the plugin handles, matched against `URL.hostname`; no scheme, port, path or
 *   wildcard.
 * - `capabilities`: at least one {@link PluginCapability}.
 */
export const manifestSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().min(1),
  version: z.string().refine(isSemverVersion, "must be a canonical semver version such as 1.2.3"),
  sdkVersion: z.string().refine(isSemverRange, "must be a bounded semver range such as >=0.0.0 <1.0.0"),
  domains: z.array(z.string().regex(HOSTNAME, "must be a lowercase hostname without scheme, port or path")).nonempty(),
  capabilities: z.array(z.enum(PluginCapability)).nonempty(),
});

/** A plugin manifest as {@link manifestSchema} accepts it. */
export type PluginManifest = z.infer<typeof manifestSchema>;
