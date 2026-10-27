import { AlertKind } from "../entities.js";
import type { Listing, PriceSnapshot } from "../entities.js";
import type { AlertDraft } from "./draft.js";

const WINDOW_DAYS = 30;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;
const BASIS_POINTS_FULL = 10_000n;

const PRICE_DROP_WINDOW_MS = WINDOW_DAYS * HOURS_PER_DAY * MS_PER_HOUR;

/**
 * Raises a price drop alert when the incoming item price is lower than every earlier snapshot in the window and at
 * least `minBasisPoints` below the window's lowest. The incoming snapshot must be in stock. Only in-stock snapshots
 * for the same destination and item currency count. Shipping is ignored, so the comparison is like for like in the
 * store's own currency. The threshold is checked in exact integer arithmetic. Returns null when the window holds
 * no earlier snapshot.
 */
export const priceDrop = (
  listing: Listing,
  history: readonly PriceSnapshot[],
  incoming: PriceSnapshot,
  minBasisPoints: number,
  now: Date,
): AlertDraft | null => {
  if (!incoming.inStock) {
    return null;
  }
  const since = now.getTime() - PRICE_DROP_WINDOW_MS;
  const low = history
    .filter(
      (snapshot) =>
        snapshot.inStock
        && snapshot.shipTo === incoming.shipTo
        && snapshot.itemPrice.currency === incoming.itemPrice.currency
        && snapshot.observedAt.getTime() >= since,
    )
    .reduce<PriceSnapshot | null>(
      (lowest, snapshot) =>
        lowest === null || snapshot.itemPrice.amountMinor < lowest.itemPrice.amountMinor ? snapshot : lowest,
      null,
    );
  if (low === null) {
    return null;
  }
  const lowMinor = BigInt(low.itemPrice.amountMinor);
  const incomingMinor = BigInt(incoming.itemPrice.amountMinor);
  const belowThreshold = incomingMinor * BASIS_POINTS_FULL <= lowMinor * (BASIS_POINTS_FULL - BigInt(minBasisPoints));
  if (incomingMinor >= lowMinor || !belowThreshold) {
    return null;
  }
  return {
    kind: AlertKind.PriceDrop,
    productId: listing.productId,
    listingId: listing.id,
    beforeSnapshotId: low.id,
    afterSnapshotId: incoming.id,
    createdAt: now,
  };
};
