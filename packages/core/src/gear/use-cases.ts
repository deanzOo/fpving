import { err, ok } from "@fpving/plugin-sdk";
import type { CatalogEntry, Clock, GearKind, Result } from "@fpving/plugin-sdk";
import type { GearItemId, PluginId } from "../ids.js";
import type { CatalogGateway } from "../ports/catalog-gateway.js";
import type { GearRepository } from "../ports/gear-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { RepositoryErrorKind } from "../ports/repository.js";
import type { NotFound } from "../ports/repository.js";
import { gearItemSchema, SpecSource } from "./entities.js";
import type { GearItem, SpecValue } from "./entities.js";
import { GearErrorKind } from "./errors.js";

/** The ports every gear use case builds on. */
export interface GearDeps {
  /** Where the gear is stored. */
  readonly gear: GearRepository;
  /** Reaches the catalog plugins. */
  readonly catalogs: CatalogGateway;
  /** Mints the gear item ids. */
  readonly ids: IdGenerator;
  /** Stamps `createdAt`. */
  readonly clock: Clock;
}

/** The raw value of one spec field. */
export type SpecRawValue = SpecValue["value"];

/** One catalog's value for a spec field. */
export interface CatalogValue {
  /** What the catalog says. */
  readonly value: SpecRawValue;
  /** The catalog that says it. */
  readonly pluginId: PluginId;
}

/** A reference to one catalog entry. */
export interface CatalogRef {
  /** The catalog. */
  readonly pluginId: PluginId;
  /** The entry's key within that catalog. */
  readonly key: string;
}

/** The same item from every catalog that knows it. */
export interface CatalogMatch {
  /** The name as the first catalog that knows it gives it. */
  readonly name: string;
  /** What kind of gear it is. */
  readonly kind: GearKind;
  /** Every catalog's value per field. A field with more than one distinct value is a disagreement. */
  readonly specs: Readonly<Record<string, readonly CatalogValue[]>>;
  /** The catalog entries merged into this match. */
  readonly refs: readonly CatalogRef[];
}

/** What {@link searchCatalog} found. */
export interface CatalogSearch {
  /** The matches, in the order the catalogs answered. */
  readonly matches: CatalogMatch[];
  /** The catalogs that could not answer. */
  readonly failedPlugins: PluginId[];
}

/** Why gear was not stored: its fields break the gear vocabulary of its kind. */
export interface InvalidSpecs {
  readonly kind: typeof GearErrorKind.InvalidSpecs;
}

/** What the user entered for a gear item. */
export interface GearDraft {
  /** What kind of gear it is. */
  readonly kind: GearKind;
  /** What the user calls it. */
  readonly name: string;
  /** How many the user owns. */
  readonly quantity: number;
  /** The catalog entry the specs were copied from, or null. */
  readonly catalogRef: GearItem["catalogRef"];
  /** The known specs with their sources. A missing field is unknown. */
  readonly specs: Readonly<Record<string, SpecValue>>;
}

/** A field whose catalog value differs from the one saved; `catalog` is null when the catalog dropped the field. */
export interface GearChange {
  /** The spec field. */
  readonly field: string;
  /** The value saved with the item. */
  readonly saved: SpecRawValue;
  /** The value the catalog gives now. */
  readonly catalog: SpecRawValue;
}

/** A stored item with the fields its catalog now says differently. */
export interface GearWithChanges {
  /** The item as stored. */
  readonly item: GearItem;
  /** The catalog-sourced fields that differ from the catalog's now. */
  readonly changes: GearChange[];
}

interface Merging {
  readonly name: string;
  readonly kind: GearKind;
  readonly specs: Record<string, CatalogValue[]>;
  readonly refs: CatalogRef[];
}

const canonical = (value: SpecRawValue): string =>
  Array.isArray(value) ? JSON.stringify(value.map((item) => JSON.stringify(item)).toSorted()) : JSON.stringify(value);

const same = (a: SpecRawValue, b: SpecRawValue): boolean => canonical(a) === canonical(b);

const fold = (name: string): string => name.trim().replaceAll(/\s+/gu, " ").toLowerCase();

const KIND_FIELD = "kind";

/**
 * Searches every installed catalog and merges the entries that are the same item: the same kind and a name equal once
 * case and whitespace are folded.
 *
 * @remarks
 * Values are never reconciled: a field two catalogs give differently keeps both. A catalog that fails is skipped and
 * listed in `failedPlugins`.
 *
 * @param deps - The ports to use.
 * @param text - What to search for.
 * @returns The merged matches and the catalogs that failed.
 */
export const searchCatalog = async ({ catalogs }: GearDeps, text: string): Promise<CatalogSearch> => {
  const answers = await Promise.all(
    catalogs.plugins().map(async (pluginId) => ({ pluginId, found: await catalogs.search(pluginId, text) })),
  );
  const failedPlugins: PluginId[] = [];
  const merged = new Map<string, Merging>();
  for (const { pluginId, found } of answers) {
    if (!found.ok) {
      failedPlugins.push(pluginId);
      continue;
    }
    for (const entry of found.value) {
      const { kind, ...fields } = entry.specs;
      const id = JSON.stringify([kind, fold(entry.name)]);
      const match = merged.get(id) ?? { name: entry.name, kind, specs: {}, refs: [] };
      for (const [field, value] of Object.entries<SpecRawValue>(fields)) {
        match.specs[field] = [...(match.specs[field] ?? []), { value, pluginId }];
      }
      match.refs.push({ pluginId, key: entry.key });
      merged.set(id, match);
    }
  }
  return { matches: [...merged.values()], failedPlugins };
};

const currentEntry = async ({ catalogs }: GearDeps, ref: GearItem["catalogRef"]): Promise<CatalogEntry | null> => {
  if (ref === null || !catalogs.plugins().includes(ref.pluginId)) {
    return null;
  }
  const found = await catalogs.get(ref.pluginId, ref.key);
  return found.ok ? found.value : null;
};

const verified = async (
  deps: GearDeps,
  draft: GearDraft,
  stored: GearItem | null,
): Promise<Record<string, SpecValue>> => {
  const entry = await currentEntry(deps, draft.catalogRef);
  const now = new Map(entry?.specs.kind === draft.kind ? Object.entries<SpecRawValue>({ ...entry.specs }) : []);
  const sameEntry = stored?.kind === draft.kind && stored.catalogRef?.key === draft.catalogRef?.key;
  const before = sameEntry ? stored.specs : {};
  const unchanged = (field: string, value: SpecRawValue): boolean => {
    const saved = before[field];
    return (
      saved?.source === SpecSource.Catalog && saved.pluginId === draft.catalogRef?.pluginId && same(saved.value, value)
    );
  };
  const confirmed = (field: string, spec: SpecValue): boolean => {
    const current = now.get(field);
    return (
      spec.source === SpecSource.Catalog
      && spec.pluginId === draft.catalogRef?.pluginId
      && ((current !== undefined && same(spec.value, current)) || unchanged(field, spec.value))
    );
  };
  return Object.fromEntries(
    Object.entries(draft.specs).map(([field, spec]) => [
      field,
      confirmed(field, spec) ? spec : { source: SpecSource.User, value: spec.value },
    ]),
  );
};

const build = (
  id: string,
  createdAt: Date,
  draft: GearDraft,
  specs: Readonly<Record<string, SpecValue>>,
): Result<GearItem, InvalidSpecs> => {
  const parsed = KIND_FIELD in specs ? null : gearItemSchema.safeParse({ ...draft, id, createdAt, specs });
  return parsed?.success === true ? ok(parsed.data) : err({ kind: GearErrorKind.InvalidSpecs });
};

/**
 * Stores a new gear item.
 *
 * @remarks
 * A field is saved as catalog-sourced only when its draft source is `catalog`, names the item's catalog plugin and its
 * value equals the field's value in the catalog's current entry, which must be the same kind of gear. Any other field,
 * including every `user` field and every field when the catalog cannot be checked, is saved as confirmed by the user.
 *
 * @param deps - The ports to use.
 * @param draft - What the user entered.
 * @returns The stored item, or `invalid_specs` when the draft breaks the gear vocabulary of its kind.
 */
export const addGear = async (deps: GearDeps, draft: GearDraft): Promise<Result<GearItem, InvalidSpecs>> => {
  const built = build(deps.ids.next(), deps.clock.now(), draft, await verified(deps, draft, null));
  if (built.ok) {
    await deps.gear.add(built.value);
  }
  return built;
};

const changesOf = async (deps: GearDeps, item: GearItem): Promise<GearChange[]> => {
  const entry = await currentEntry(deps, item.catalogRef);
  if (entry?.specs.kind !== item.kind || item.catalogRef === null) {
    return [];
  }
  const { pluginId } = item.catalogRef;
  const now: Record<string, SpecRawValue> = { ...entry.specs };
  return Object.entries(item.specs).flatMap(([field, spec]) =>
    spec.source === SpecSource.Catalog && spec.pluginId === pluginId && !same(spec.value, now[field] ?? null)
      ? [{ field, saved: spec.value, catalog: now[field] ?? null }]
      : [],
  );
};

/**
 * Lists the stored gear, each item with the catalog-sourced fields its catalog now says differently.
 *
 * @remarks
 * Nothing is flagged for an item without a catalog entry, whose plugin is not loaded, whose entry is gone or is now
 * another kind of gear, or whose catalog errors. A field the user confirmed is never flagged.
 *
 * @param deps - The ports to use.
 * @returns Every item with its changes.
 */
export const listGear = async (deps: GearDeps): Promise<GearWithChanges[]> =>
  Promise.all((await deps.gear.list()).map(async (item) => ({ item, changes: await changesOf(deps, item) })));

/**
 * Replaces a stored item with the draft. See {@link addGear} for how each field's source is settled.
 *
 * @remarks
 * A catalog-sourced field whose plugin and value equal the stored item's catalog-sourced field also stays
 * catalog-sourced while the item keeps its kind and catalog entry, so a field left as it was keeps its source and its
 * change flag even when the catalog changed or is gone.
 *
 * @param deps - The ports to use.
 * @param id - The item to edit.
 * @param draft - What the user entered.
 * @returns The stored item, `not_found` for an unknown id, or `invalid_specs`.
 */
export const updateGear = async (
  deps: GearDeps,
  id: GearItemId,
  draft: GearDraft,
): Promise<Result<GearItem, NotFound | InvalidSpecs>> => {
  const stored = await deps.gear.get(id);
  if (stored === null) {
    return err({ kind: RepositoryErrorKind.NotFound });
  }
  const built = build(id, stored.createdAt, draft, await verified(deps, draft, stored));
  if (!built.ok) {
    return built;
  }
  const updated = await deps.gear.update(built.value);
  return updated.ok ? built : updated;
};

/**
 * Deletes a stored item.
 *
 * @param deps - The ports to use.
 * @param id - The item to delete.
 * @returns `not_found` when no such item is stored.
 */
export const removeGear = async (deps: GearDeps, id: GearItemId): Promise<Result<void, NotFound>> =>
  deps.gear.remove(id);
