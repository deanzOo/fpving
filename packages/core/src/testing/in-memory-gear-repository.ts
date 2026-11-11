import { err, GearKind, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import type { GearItem } from "../gear/entities.js";
import type { GearItemId } from "../ids.js";
import type { GearRepository } from "../ports/gear-repository.js";
import { RepositoryErrorKind } from "../ports/repository.js";
import type { NotFound } from "../ports/repository.js";

const KIND_ORDER: readonly string[] = Object.values(GearKind);

const byKindThenName = (a: GearItem, b: GearItem): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);

/** A {@link GearRepository} held in memory that rejects a repeated id the way a database would, for tests. */
export class InMemoryGearRepository implements GearRepository {
  private readonly items = new Map<GearItemId, GearItem>();

  public async add(item: GearItem): Promise<void> {
    if (this.items.has(item.id)) {
      return Promise.reject(new Error("duplicate id"));
    }
    this.items.set(item.id, structuredClone(item));
    return Promise.resolve();
  }

  public async get(id: GearItemId): Promise<GearItem | null> {
    const item = this.items.get(id);
    return Promise.resolve(item === undefined ? null : structuredClone(item));
  }

  public async list(): Promise<GearItem[]> {
    return Promise.resolve(structuredClone([...this.items.values()].toSorted(byKindThenName)));
  }

  public async update(item: GearItem): Promise<Result<void, NotFound>> {
    if (!this.items.has(item.id)) {
      return Promise.resolve(err({ kind: RepositoryErrorKind.NotFound }));
    }
    this.items.set(item.id, structuredClone(item));
    return Promise.resolve(ok(undefined));
  }

  public async remove(id: GearItemId): Promise<Result<void, NotFound>> {
    return Promise.resolve(this.items.delete(id) ? ok(undefined) : err({ kind: RepositoryErrorKind.NotFound }));
  }
}
