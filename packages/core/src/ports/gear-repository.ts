import type { Result } from "@fpving/plugin-sdk";
import type { GearItem } from "../gear/entities.js";
import type { GearItemId } from "../ids.js";
import type { NotFound } from "./repository.js";

/** Stores the gear the user owns. */
export interface GearRepository {
  /** Stores a new gear item. Rejects when the id is already stored. */
  add(item: GearItem): Promise<void>;
  /** The item, or null when it is not stored. */
  get(id: GearItemId): Promise<GearItem | null>;
  /** Every item, grouped by kind in `GearKind` order, then by name. */
  list(): Promise<GearItem[]>;
  /** Replaces a stored item. */
  update(item: GearItem): Promise<Result<void, NotFound>>;
  /** Deletes a stored item. */
  remove(id: GearItemId): Promise<Result<void, NotFound>>;
}
