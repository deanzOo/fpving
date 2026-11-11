import { GearKind } from "@fpving/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { gearItemIdSchema, gearItemSchema, pluginIdSchema, RepositoryErrorKind, SpecSource } from "../index.js";
import type { GearItem, GearRepository } from "../index.js";

const ok = { ok: true, value: undefined };
const notFound = { ok: false, error: { kind: RepositoryErrorKind.NotFound } };
const CREATED = new Date("2026-01-01T03:04:05.678Z");
const CELLS = 4;
const MISSING = gearItemIdSchema.parse("missing");

const item = (id: string, kind: GearItem["kind"], name: string, specs: GearItem["specs"] = {}): GearItem =>
  gearItemSchema.parse({
    id,
    kind,
    name,
    quantity: 1,
    createdAt: CREATED,
    catalogRef: { pluginId: pluginIdSchema.parse("example-catalog"), key: id },
    specs,
  });

/**
 * Registers the behaviour every {@link GearRepository} implementation must have, as a Vitest suite named "Gear
 * repository contract". Each test gets a fresh, empty repository from `makeRepository`.
 *
 * @example
 * ```ts
 * import { describeGearRepositoryContract } from "@fpving/core/testing";
 *
 * describeGearRepositoryContract(async () => sqliteGearRepository(":memory:"));
 * ```
 */
export const describeGearRepositoryContract = (makeRepository: () => Promise<GearRepository>): void => {
  describe("Gear repository contract", () => {
    let repo: GearRepository;
    const pack = item("b1", GearKind.Battery, "Tattu 1300", { cells: { source: SpecSource.User, value: CELLS } });

    beforeEach(async () => {
      repo = await makeRepository();
    });

    it("gives back a stored item exactly as it was added", async () => {
      await repo.add(pack);
      expect(await repo.get(pack.id)).toEqual(pack);
    });

    it("gives null for an item that is not stored", async () => {
      expect(await repo.get(MISSING)).toBeNull();
    });

    it("rejects adding an id that is already stored", async () => {
      await repo.add(pack);
      await expect(repo.add(pack)).rejects.toThrow();
    });

    it("lists gear grouped by kind, then by name", async () => {
      await repo.add(item("t1", GearKind.Tool, "Hex set"));
      await repo.add(item("b2", GearKind.Battery, "Tattu 1300"));
      await repo.add(item("r1", GearKind.Radio, "Zorro"));
      await repo.add(item("b3", GearKind.Battery, "CNHL 850"));
      expect((await repo.list()).map((row) => row.id)).toEqual(["r1", "b3", "b2", "t1"]);
    });

    it("replaces a stored item on update", async () => {
      await repo.add(pack);
      const renamed = { ...pack, name: "Tattu 1300 4S", quantity: 3 };
      expect(await repo.update(renamed)).toEqual(ok);
      expect(await repo.get(pack.id)).toEqual(renamed);
    });

    it("refuses to update an item that is not stored", async () => {
      expect(await repo.update({ ...pack, id: MISSING })).toEqual(notFound);
    });

    it("deletes a stored item and refuses to delete it twice", async () => {
      await repo.add(pack);
      expect(await repo.remove(pack.id)).toEqual(ok);
      expect(await repo.get(pack.id)).toBeNull();
      expect(await repo.remove(pack.id)).toEqual(notFound);
    });
  });
};
