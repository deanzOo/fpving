import { z } from "zod";
import { amountSchema, moneySchema } from "./money.js";

/** Whether a listing's shipping cost to the destination country is known. */
export const ShippingKind = { Known: "known", Unknown: "unknown" } as const;

/** One of the {@link ShippingKind} values. */
export type ShippingKind = (typeof ShippingKind)[keyof typeof ShippingKind];

/** Shipping whose cost the store did not show. The host never treats it as free. */
export const ShippingUnknown = { kind: ShippingKind.Unknown } as const;

/** Shipping to the context's `shipTo` country: a known cost, which may be zero, or {@link ShippingUnknown}. */
export const shippingSchema = z.discriminatedUnion("kind", [
  amountSchema.extend({ kind: z.literal(ShippingKind.Known) }),
  z.object({ kind: z.literal(ShippingKind.Unknown) }),
]);

/** Shipping as {@link shippingSchema} accepts it. */
export type Shipping = z.infer<typeof shippingSchema>;

/** An absolute http or https URL string, the form every URL takes across the host and plugin boundary. */
export const httpUrlSchema = z.url({ protocol: /^https?$/ });

/**
 * What {@link Store.fetchListing} returns for one product page. The host parses every listing with this schema
 * before it enters core, so a plugin cannot record a placeholder price or a script URL.
 *
 * @remarks
 * - `title`: the product title as the store shows it, not blank.
 * - `itemPrice`: the item price in the store's own currency, see {@link moneySchema}.
 * - `shipping`: see {@link shippingSchema}.
 * - `inStock`: false when the store shows the item as unavailable.
 * - `images`: absolute http or https image URLs, possibly empty.
 */
export const fetchedListingSchema = z.object({
  title: z.string().trim().min(1),
  itemPrice: moneySchema,
  shipping: shippingSchema,
  inStock: z.boolean(),
  images: z.array(httpUrlSchema),
});

/** A listing as {@link fetchedListingSchema} accepts it. */
export type FetchedListing = z.infer<typeof fetchedListingSchema>;

/**
 * One result of {@link Store.search}: a listing that may be the product searched for.
 *
 * @remarks
 * `url` is an absolute http or https URL string rather than a `URL` object, because results cross a worker thread
 * boundary and `URL` objects cannot be structured-cloned. `itemPrice` is optional because many search pages omit it.
 */
export const searchCandidateSchema = z.object({
  url: httpUrlSchema,
  title: z.string().trim().min(1),
  itemPrice: moneySchema.optional(),
});

/** A search result as {@link searchCandidateSchema} accepts it. */
export type SearchCandidate = z.infer<typeof searchCandidateSchema>;
