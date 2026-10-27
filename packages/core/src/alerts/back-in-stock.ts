import { AlertKind } from "../entities.js";
import type { Listing, PriceSnapshot } from "../entities.js";
import type { AlertDraft } from "./draft.js";

/**
 * Raises a back in stock alert when the newest earlier snapshot for the same destination was out of stock and the
 * incoming one is in stock. Returns null otherwise, including when there is no earlier snapshot.
 */
export const backInStock = (
  listing: Listing,
  history: readonly PriceSnapshot[],
  incoming: PriceSnapshot,
  now: Date,
): AlertDraft | null => {
  const previous = history
    .filter((snapshot) => snapshot.shipTo === incoming.shipTo)
    .reduce<PriceSnapshot | null>(
      (newest, snapshot) => (newest === null || snapshot.observedAt > newest.observedAt ? snapshot : newest),
      null,
    );
  if (previous === null || previous.inStock || !incoming.inStock) {
    return null;
  }
  return {
    kind: AlertKind.BackInStock,
    productId: listing.productId,
    listingId: listing.id,
    beforeSnapshotId: previous.id,
    afterSnapshotId: incoming.id,
    createdAt: now,
  };
};
