import type { Listing, PriceSnapshot } from "../entities.js";
import type { ListingId } from "../ids.js";
import type { FxTable } from "../pricing/fx.js";
import { backInStock } from "./back-in-stock.js";
import type { AlertDraft, AlertSettings, ListingWithLatest } from "./draft.js";
import { newCheapest } from "./new-cheapest.js";
import { priceDrop } from "./price-drop.js";

/**
 * Everything one evaluation reads. `history` is the listing's earlier snapshots, `incoming` the one just observed.
 * `productListings` holds every listing of the product with its newest snapshot, the incoming one included.
 */
export interface EvaluateInput {
  listing: Listing;
  history: readonly PriceSnapshot[];
  incoming: PriceSnapshot;
  productListings: readonly ListingWithLatest[];
  previousCheapestListingId: ListingId | null;
  rates: FxTable;
  settings: AlertSettings;
  now: Date;
}

/** What one evaluation decided: the alerts to raise, and the product's cheapest listing for the next evaluation. */
export interface Evaluation {
  alerts: AlertDraft[];
  cheapestListingId: ListingId | null;
}

/**
 * Decides which alerts a new snapshot raises: price drop, back in stock and new cheapest, in that order. Pure: it
 * reads only its input, and the caller assigns alert ids and persists `cheapestListingId`.
 */
export const evaluate = (input: EvaluateInput): Evaluation => {
  const { listing, history, incoming, now } = input;
  const cheapest = newCheapest(
    listing,
    input.productListings,
    input.previousCheapestListingId,
    input.rates,
    input.settings,
    now,
  );
  const drafts = [
    priceDrop(listing, history, incoming, input.settings.priceDropMinBasisPoints, now),
    backInStock(listing, history, incoming, now),
    cheapest.alert,
  ];
  return {
    alerts: drafts.filter((draft) => draft !== null),
    cheapestListingId: cheapest.cheapestListingId,
  };
};
