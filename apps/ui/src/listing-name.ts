import type { Listing } from "@fpving/core";

/**
 * The name a listing goes by on screen and to assistive technology: its store and its title, so two listings on the
 * same store read apart. A title is never empty.
 *
 * @param listing - The listing.
 * @returns The name.
 */
export const listingName = ({ pluginId, title }: Pick<Listing, "pluginId" | "title">): string =>
  `${pluginId}: ${title}`;
