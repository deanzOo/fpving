import { err } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import type { ListingId, ProductId } from "../ids.js";
import type { NotFound } from "../ports/repository.js";
import { liveProduct } from "./add.js";
import type { CoreDeps, ProductNotFound } from "./add.js";
import { AddErrorKind } from "./errors.js";

/**
 * Removes a listing from a product. It is never scanned again and no longer counts for the product's cheapest price
 * or its alerts; its snapshots and alerts are kept.
 *
 * @param deps - The repository.
 * @param productId - The product.
 * @param listingId - The product's listing to remove.
 * @returns `product_not_found` for a product that is missing or archived, `not_found` for a listing that is not the
 *   product's or already removed.
 */
export const removeListing = async (
  { repository }: Pick<CoreDeps, "repository">,
  productId: ProductId,
  listingId: ListingId,
): Promise<Result<void, ProductNotFound | NotFound>> =>
  (await liveProduct(repository, productId)) === null
    ? err({ kind: AddErrorKind.ProductNotFound })
    : repository.listings.remove(productId, listingId);
