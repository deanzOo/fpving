import { catalogEntrySchema, CatalogErrorKind, err, GearKind } from "@fpving/plugin-sdk";
import type { CatalogEntry, CatalogError, Result } from "@fpving/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addGear,
  gearItemIdSchema,
  gearItemSchema,
  listGear,
  pluginIdSchema,
  removeGear,
  RepositoryErrorKind,
  searchCatalog,
  SpecSource,
  updateGear,
} from "../../src/index.ts";
import type { GearDeps, GearDraft, GearItem, PluginId } from "../../src/index.ts";
import { FakeCatalogGateway, InMemoryGearRepository } from "../../src/testing/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";

const ONE = pluginIdSchema.parse("catalog-one");
const TWO = pluginIdSchema.parse("catalog-two");
const NOW = new Date("2026-02-03T04:05:06.000Z");
const CELLS = 4;
const OTHER_CELLS = 6;
const MORE_CELLS = 3;

const battery = (key: string, name: string, specs: Record<string, unknown>): CatalogEntry =>
  catalogEntrySchema.parse({ key, name, specs: { kind: GearKind.Battery, ...specs } });

const DOWN: CatalogError = { kind: CatalogErrorKind.Failed, detail: "down" };

class FlakyCatalogGateway extends FakeCatalogGateway {
  public constructor(
    entries: ReadonlyMap<PluginId, readonly CatalogEntry[]>,
    private readonly down: PluginId,
  ) {
    super(entries);
  }

  public override async search(pluginId: PluginId, text: string): Promise<Result<CatalogEntry[], CatalogError>> {
    return pluginId === this.down ? Promise.resolve(err(DOWN)) : super.search(pluginId, text);
  }

  public override async get(pluginId: PluginId, key: string): Promise<Result<CatalogEntry | null, CatalogError>> {
    return pluginId === this.down ? Promise.resolve(err(DOWN)) : super.get(pluginId, key);
  }
}

class VanishingGearRepository extends InMemoryGearRepository {
  public constructor(private readonly seed: GearItem[]) {
    super();
  }

  public override async get(): Promise<GearItem | null> {
    return Promise.resolve(this.seed[0] ?? null);
  }
}

const depsFor = (catalogs: FakeCatalogGateway): GearDeps => ({
  gear: new InMemoryGearRepository(),
  catalogs,
  ids: fakeIdGenerator(),
  clock: fakeClock(NOW),
});

const draft = (overrides: Partial<GearDraft> = {}): GearDraft => ({
  kind: GearKind.Battery,
  name: "Tattu 1300",
  quantity: 1,
  catalogRef: { pluginId: ONE, key: "t1300" },
  specs: { cells: { source: SpecSource.Catalog, pluginId: ONE, value: CELLS } },
  ...overrides,
});

const T1300 = battery("t1300", "Tattu 1300", { cells: CELLS });
const QUAD = { kind: GearKind.Quad, cells: CELLS };

const seed = async (deps: GearDeps, overrides: Partial<GearDraft> = {}): Promise<GearItem> => {
  const item = gearItemSchema.parse({ ...draft(overrides), id: "seed-1", createdAt: NOW });
  await deps.gear.add(item);
  return item;
};

const gateway = (entries: [PluginId, CatalogEntry[]][]): FakeCatalogGateway => new FakeCatalogGateway(new Map(entries));

describe("Catalog search", () => {
  it("merges the same item from two catalogs", async () => {
    const deps = depsFor(
      gateway([
        [ONE, [battery("a", "Tattu  1300", { cells: CELLS })]],
        [TWO, [battery("b", "tattu 1300", { chemistry: "lipo" })]],
      ]),
    );
    const { matches, failedPlugins } = await searchCatalog(deps, "tattu");
    expect(failedPlugins).toEqual([]);
    expect(matches).toEqual([
      {
        name: "Tattu  1300",
        kind: GearKind.Battery,
        specs: { cells: [{ value: CELLS, pluginId: ONE }], chemistry: [{ value: "lipo", pluginId: TWO }] },
        refs: [
          { pluginId: ONE, key: "a" },
          { pluginId: TWO, key: "b" },
        ],
      },
    ]);
  });

  it("keeps both values when two catalogs disagree", async () => {
    const deps = depsFor(
      gateway([
        [ONE, [battery("a", "Tattu 1300", { cells: CELLS })]],
        [TWO, [battery("b", "Tattu 1300", { cells: OTHER_CELLS })]],
      ]),
    );
    const { matches } = await searchCatalog(deps, "tattu");
    expect(matches[0]?.specs["cells"]).toEqual([
      { value: CELLS, pluginId: ONE },
      { value: OTHER_CELLS, pluginId: TWO },
    ]);
  });

  it("never merges entries of different kinds", async () => {
    const tool = catalogEntrySchema.parse({ key: "c", name: "Tattu 1300", specs: { kind: GearKind.Tool } });
    const deps = depsFor(gateway([[ONE, [battery("a", "Tattu 1300", {}), tool]]]));
    expect((await searchCatalog(deps, "tattu")).matches.map((match) => match.kind)).toEqual([
      GearKind.Battery,
      GearKind.Tool,
    ]);
  });

  it("still answers when one catalog fails", async () => {
    const entries = new Map([
      [ONE, [battery("a", "Tattu 1300", {})]],
      [TWO, [battery("b", "Tattu 1300", {})]],
    ]);
    const deps = { ...depsFor(gateway([])), catalogs: new FlakyCatalogGateway(entries, ONE) };
    const { matches, failedPlugins } = await searchCatalog(deps, "tattu");
    expect(failedPlugins).toEqual([ONE]);
    expect(matches.map((match) => match.refs)).toEqual([[{ pluginId: TWO, key: "b" }]]);
  });

  it("answers nothing when no catalog is installed", async () => {
    expect(await searchCatalog(depsFor(gateway([])), "tattu")).toEqual({ matches: [], failedPlugins: [] });
  });
});

describe("Adding gear", () => {
  it("copies catalog specs with their plugin as the source", async () => {
    const deps = depsFor(gateway([[ONE, [T1300]]]));
    const added = await addGear(deps, draft());
    expect(added).toMatchObject({
      ok: true,
      value: {
        id: "id-1",
        createdAt: NOW,
        specs: { cells: { source: SpecSource.Catalog, pluginId: ONE, value: CELLS } },
      },
    });
    expect(await deps.gear.list()).toHaveLength(1);
  });

  it("saves a catalog source that does not match the catalog as confirmed by the user", async () => {
    const deps = depsFor(gateway([[ONE, [T1300]]]));
    const wrong = { cells: { source: SpecSource.Catalog, pluginId: ONE, value: OTHER_CELLS } };
    const added = await addGear(deps, draft({ specs: wrong }));
    expect(added).toMatchObject({ ok: true, value: { specs: { cells: { source: SpecSource.User } } } });
  });

  it("saves a catalog source from another plugin than the item's catalog as confirmed by the user", async () => {
    const deps = depsFor(gateway([[ONE, [T1300]]]));
    const other = { cells: { source: SpecSource.Catalog, pluginId: TWO, value: CELLS } };
    const added = await addGear(deps, draft({ specs: other }));
    expect(added).toMatchObject({ ok: true, value: { specs: { cells: { source: SpecSource.User } } } });
  });

  it("saves a catalog source as confirmed by the user when the catalog cannot be checked", async () => {
    const entries = new Map([[ONE, [T1300]]]);
    const down = { ...depsFor(gateway([])), catalogs: new FlakyCatalogGateway(entries, ONE) };
    const gone = depsFor(gateway([]));
    const noRef = draft({ catalogRef: null });
    for (const [deps, item] of [[down, draft()], [gone, draft()], [gone, noRef]] as const) {
      const added = await addGear(deps, item);
      expect(added).toMatchObject({ ok: true, value: { specs: { cells: { source: SpecSource.User } } } });
    }
  });

  it.each([
    ["has no such entry", []],
    ["entry is another kind of gear", [catalogEntrySchema.parse({ key: "t1300", name: "Tattu 1300", specs: QUAD })]],
  ])("saves a catalog source as confirmed by the user when the catalog %s", async (_, entries) => {
    const deps = depsFor(gateway([[ONE, entries]]));
    const added = await addGear(deps, draft());
    expect(added).toMatchObject({ ok: true, value: { specs: { cells: { source: SpecSource.User } } } });
  });

  it("saves an item with unknown specs", async () => {
    const deps = depsFor(gateway([]));
    const added = await addGear(deps, draft({ catalogRef: null, specs: {} }));
    expect(added).toMatchObject({ ok: true, value: { specs: {} } });
  });

  it("refuses specs that break the vocabulary", async () => {
    const deps = depsFor(gateway([]));
    const bad = [
      { chemistry: { source: SpecSource.User, value: "nicd" } },
      { rcLink: { source: SpecSource.User, value: "elrs-2g4" } },
      { kind: { source: SpecSource.User, value: GearKind.Tool } },
    ];
    for (const specs of bad) {
      expect(await addGear(deps, draft({ specs }))).toEqual({ ok: false, error: { kind: "invalid_specs" } });
    }
    expect(await deps.gear.list()).toEqual([]);
  });
});

describe("Listing gear", () => {
  let deps: GearDeps;

  beforeEach(() => {
    deps = depsFor(gateway([[ONE, [battery("t1300", "Tattu 1300", { cells: OTHER_CELLS })]]]));
  });

  it("flags a field the catalog has changed since it was saved", async () => {
    await seed(deps);
    const [row] = await listGear(deps);
    expect(row?.changes).toEqual([{ field: "cells", saved: CELLS, catalog: OTHER_CELLS }]);
  });

  it("keeps an item's specs and flags nothing when its catalog plugin is gone", async () => {
    await seed(deps);
    const bare = { ...deps, catalogs: gateway([]) };
    const [row] = await listGear(bare);
    expect(row?.changes).toEqual([]);
    expect(row?.item.specs["cells"]).toEqual({ source: SpecSource.Catalog, pluginId: ONE, value: CELLS });
  });

  it("flags nothing when the catalog no longer has the entry or errors", async () => {
    await seed(deps);
    const missing = { ...deps, catalogs: gateway([[ONE, []]]) };
    expect((await listGear(missing))[0]?.changes).toEqual([]);
    const failing = { ...deps, catalogs: new FlakyCatalogGateway(new Map(), ONE) };
    expect((await listGear(failing))[0]?.changes).toEqual([]);
  });

  it("flags a field the catalog dropped and ignores items without a catalog", async () => {
    await seed(deps);
    await addGear(deps, draft({ name: "Zed", catalogRef: null, specs: {} }));
    const dropped = { ...deps, catalogs: gateway([[ONE, [battery("t1300", "Tattu 1300", {})]]]) };
    const rows = await listGear(dropped);
    expect(rows.map((row) => row.changes)).toEqual([[{ field: "cells", saved: CELLS, catalog: null }], []]);
  });

  it("does not flag reordered list values as a change", async () => {
    const charger = (cells: unknown): CatalogEntry =>
      catalogEntrySchema.parse({ key: "c1", name: "Charger", specs: { kind: GearKind.Charger, cells } });
    const listed = depsFor(gateway([[ONE, [charger([OTHER_CELLS, CELLS])]]]));
    const kind = GearKind.Charger;
    await seed(listed, { kind, name: "Charger", catalogRef: { pluginId: ONE, key: "c1" }, specs: {
      cells: { source: SpecSource.Catalog, pluginId: ONE, value: [CELLS, OTHER_CELLS] },
    } });
    expect((await listGear(listed))[0]?.changes).toEqual([]);
    const grown = { ...listed, catalogs: gateway([[ONE, [charger([OTHER_CELLS, CELLS, MORE_CELLS])]]]) };
    expect((await listGear(grown))[0]?.changes).toHaveLength(1);
  });

  it("flags nothing when the catalog entry is now another kind of gear", async () => {
    await seed(deps);
    const quad = catalogEntrySchema.parse({ key: "t1300", name: "Tattu 1300", specs: { ...QUAD, cells: OTHER_CELLS } });
    expect((await listGear({ ...deps, catalogs: gateway([[ONE, [quad]]]) }))[0]?.changes).toEqual([]);
  });

  it("never flags a field the user confirmed", async () => {
    await addGear(deps, draft({ specs: { cells: { source: SpecSource.User, value: CELLS } } }));
    expect((await listGear(deps))[0]?.changes).toEqual([]);
  });
});

describe("Editing gear", () => {
  const stored = async (deps: GearDeps): Promise<GearItem> => {
    const added = await addGear(deps, draft());
    return gearItemSchema.parse(added.ok ? added.value : null);
  };

  it("saves a catalog source that does not match the catalog as confirmed by the user", async () => {
    const deps = depsFor(gateway([[ONE, [T1300]]]));
    const { id } = await stored(deps);
    const edited = await updateGear(deps, id, {
      ...draft(),
      quantity: 2,
      specs: { cells: { source: SpecSource.Catalog, pluginId: ONE, value: OTHER_CELLS } },
    });
    expect(edited).toMatchObject({
      ok: true,
      value: { quantity: 2, specs: { cells: { source: SpecSource.User, value: OTHER_CELLS } } },
    });
    expect(await deps.gear.get(id)).toMatchObject({ quantity: 2, createdAt: NOW });
  });

  it("clears the change flag when the user keeps their own value", async () => {
    const deps = depsFor(gateway([[ONE, [battery("t1300", "Tattu 1300", { cells: OTHER_CELLS })]]]));
    const { id } = await seed(deps);
    expect((await listGear(deps))[0]?.changes).toHaveLength(1);
    const mine = { cells: { source: SpecSource.User, value: CELLS } };
    const kept = await updateGear(deps, id, draft({ specs: mine }));
    expect(kept).toMatchObject({ ok: true, value: { specs: { cells: { source: SpecSource.User, value: CELLS } } } });
    expect((await listGear(deps))[0]?.changes).toEqual([]);
  });

  it("keeps a value taken from the catalog sourced from the catalog", async () => {
    const deps = depsFor(gateway([[ONE, [battery("t1300", "Tattu 1300", { cells: OTHER_CELLS })]]]));
    const { id } = await seed(deps);
    const theirs = { cells: { source: SpecSource.Catalog, pluginId: ONE, value: OTHER_CELLS } };
    const used = await updateGear(deps, id, draft({ specs: theirs }));
    expect(used).toMatchObject({ ok: true, value: { specs: { cells: theirs.cells } } });
    expect((await listGear(deps))[0]?.changes).toEqual([]);
  });

  it("resolving one change keeps the other change flagged", async () => {
    const changed = battery("t1300", "Tattu 1300", { cells: OTHER_CELLS, chemistry: "lihv" });
    const deps = depsFor(gateway([[ONE, [changed]]]));
    const chemistry = { source: SpecSource.Catalog, pluginId: ONE, value: "lipo" };
    const { id } = await seed(deps, { specs: { ...draft().specs, chemistry } });
    const mine = { cells: { source: SpecSource.User, value: CELLS }, chemistry };
    const kept = await updateGear(deps, id, draft({ specs: mine }));
    expect(kept).toMatchObject({ ok: true, value: { specs: { chemistry } } });
    expect((await listGear(deps))[0]?.changes).toEqual([{ field: "chemistry", saved: "lipo", catalog: "lihv" }]);
  });

  it("editing only the quantity while the catalog is disabled keeps catalog sources", async () => {
    const deps = depsFor(gateway([]));
    const { id, specs } = await seed(deps);
    const edited = await updateGear(deps, id, draft({ quantity: 2, specs }));
    expect(edited).toMatchObject({ ok: true, value: { quantity: 2, specs: draft().specs } });
  });

  it("pointing an item at another catalog entry saves its old catalog values as confirmed by the user", async () => {
    const deps = depsFor(gateway([]));
    const { id, specs } = await seed(deps);
    const moved = await updateGear(deps, id, draft({ catalogRef: { pluginId: ONE, key: "t1500" }, specs }));
    const mine = { cells: { source: SpecSource.User, value: CELLS } };
    expect(moved).toMatchObject({ ok: true, value: { specs: mine } });
  });

  it("an edited catalog value is still saved as confirmed by the user", async () => {
    const deps = depsFor(gateway([[ONE, [battery("t1300", "Tattu 1300", { cells: OTHER_CELLS })]]]));
    const { id } = await seed(deps);
    const edited = { cells: { source: SpecSource.Catalog, pluginId: ONE, value: MORE_CELLS } };
    const saved = await updateGear(deps, id, draft({ specs: edited }));
    const mine = { cells: { source: SpecSource.User, value: MORE_CELLS } };
    expect(saved).toMatchObject({ ok: true, value: { specs: mine } });
  });

  it("saves a field the item did not have as the user gave it", async () => {
    const deps = depsFor(gateway([]));
    const { id } = await stored(deps);
    const chemistry = { source: SpecSource.User, value: "lipo" };
    const edited = await updateGear(deps, id, draft({ specs: { ...draft().specs, chemistry } }));
    expect(edited).toMatchObject({ ok: true, value: { specs: { chemistry } } });
  });

  it("reports an item removed while it was being edited as not found", async () => {
    const deps = depsFor(gateway([]));
    const { id } = await stored(deps);
    const racing = { ...deps, gear: new VanishingGearRepository(await deps.gear.list()) };
    expect(await updateGear(racing, id, draft())).toEqual({ ok: false, error: { kind: RepositoryErrorKind.NotFound } });
  });

  it("refuses an unknown item and specs that break the vocabulary", async () => {
    const deps = depsFor(gateway([]));
    const { id } = await stored(deps);
    const missing = gearItemIdSchema.parse("missing");
    const notFound = { ok: false, error: { kind: RepositoryErrorKind.NotFound } };
    expect(await updateGear(deps, missing, draft())).toEqual(notFound);
    const bad = { chemistry: { source: SpecSource.User, value: "nicd" } };
    expect(await updateGear(deps, id, draft({ specs: bad }))).toEqual({ ok: false, error: { kind: "invalid_specs" } });
  });
});

describe("Removing gear", () => {
  it("deletes an item and refuses to delete it twice", async () => {
    const deps = depsFor(gateway([]));
    const added = await addGear(deps, draft());
    const id = added.ok ? added.value.id : gearItemIdSchema.parse("unreachable");
    expect(await removeGear(deps, id)).toEqual({ ok: true, value: undefined });
    expect(await removeGear(deps, id)).toEqual({ ok: false, error: { kind: RepositoryErrorKind.NotFound } });
  });
});
