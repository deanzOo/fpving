import type { Alert, Listing, PriceSnapshot, Settings } from "../entities.js";

/** An alert before it is persisted: everything an {@link Alert} has except the id the use case assigns and `readAt`. */
export type AlertDraft = Omit<Alert, "id" | "readAt">;

/** A product's listing with its newest snapshot. */
export interface ListingWithLatest {
  listing: Listing;
  latest: PriceSnapshot;
}

/** The settings alert evaluation reads. */
export type AlertSettings = Pick<
  Settings,
  "displayCurrency" | "shipToCountry" | "importTax" | "priceDropMinBasisPoints"
>;
