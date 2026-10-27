import { ShippingKind } from "@fpving/plugin-sdk";
import type { FetchedListing, StoreResult } from "@fpving/plugin-sdk";
import { ok } from "../../src/index.ts";

/** A successful USD fetch of `amountMinor` with free shipping. */
export const fetchedListing = (amountMinor: number, inStock = true): StoreResult<FetchedListing> =>
  ok({
    title: "Fetched",
    itemPrice: { amountMinor, currency: "USD" },
    shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
    inStock,
    images: [],
  });
