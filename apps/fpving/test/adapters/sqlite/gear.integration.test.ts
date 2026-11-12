import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeGearRepositoryContract } from "@fpving/core/testing";
import { gearItemIdSchema, gearItemSchema, pluginIdSchema, productIdSchema, SpecSource } from "@fpving/core";
import type { GearItem } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate } from "../../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../../src/adapters/sqlite/repository.ts";
import { recordingLogger } from "../../support/recording-logger.ts";
import { cleanUpTemp, openTempSqlite, tempDir } from "./temp-db.ts";

const APP_MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const CELLS = 4;
const CAPACITY = 1300;
const QUANTITY = 2;
const PLUGIN = pluginIdSchema.parse("example-catalog");
const NO_QUANTITY = 0;

afterEach(cleanUpTemp);

describeGearRepositoryContract(async () => Promise.resolve(openTempSqlite().repository.gear));

const pack: GearItem = gearItemSchema.parse({
  id: "b1",
  kind: GearKind.Battery,
  name: "Tattu 1300",
  quantity: QUANTITY,
  createdAt: new Date("2026-01-01T03:04:05.678Z"),
  catalogRef: { pluginId: PLUGIN, key: "tattu-1300" },
  specs: {
    cells: { source: SpecSource.Catalog, pluginId: PLUGIN, value: CELLS },
    capacityMah: { source: SpecSource.User, value: CAPACITY },
    chemistry: { source: SpecSource.User, value: "lipo" },
  },
});

const insertRaw = (path: string, values: Record<string, string | number | null>): void => {
  const client = new Database(path);
  const columns = Object.keys(values);
  try {
    client.prepare(`insert into gear_items (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`).run(
      ...Object.values(values),
    );
  } finally {
    client.close();
  }
};

const row = {
  id: "r1",
  kind: GearKind.Battery,
  name: "Row",
  quantity: 1,
  created_at: 0,
  catalog_plugin_id: null,
  catalog_key: null,
  specs_json: "{}",
};

describe("Gear table", () => {
  it("round-trips an item with specs and their sources", async () => {
    const { repository, path } = openTempSqlite();
    await repository.gear.add(pack);
    expect(await repository.gear.get(pack.id)).toEqual(pack);
    const client = new Database(path, { readonly: true });
    const stored = z.object({ catalog_plugin_id: z.string(), catalog_key: z.string(), created_at: z.number() })
      .parse(client.prepare("select catalog_plugin_id, catalog_key, created_at from gear_items").get());
    client.close();
    expect(stored).toEqual({
      catalog_plugin_id: PLUGIN,
      catalog_key: "tattu-1300",
      created_at: pack.createdAt.getTime(),
    });
  });

  it("round-trips an item that came from no catalog", async () => {
    const { repository } = openTempSqlite();
    const own = { ...pack, catalogRef: null };
    await repository.gear.add(own);
    expect(await repository.gear.get(own.id)).toEqual(own);
  });

  it("refuses a quantity below one", () => {
    const { path } = openTempSqlite();
    expect(() => {
      insertRaw(path, { ...row, quantity: NO_QUANTITY });
    }).toThrow(/gear_items_quantity_check/);
  });

  it("refuses a kind that is not a gear kind", () => {
    const { path } = openTempSqlite();
    expect(() => {
      insertRaw(path, { ...row, kind: "drone" });
    }).toThrow(/gear_items_kind_check/);
  });

  it("refuses a catalog plugin without a catalog key", () => {
    const { path } = openTempSqlite();
    expect(() => {
      insertRaw(path, { ...row, catalog_plugin_id: PLUGIN });
    }).toThrow(/gear_items_catalog_ref_check/);
    expect(() => {
      insertRaw(path, { ...row, catalog_key: "k" });
    }).toThrow(/gear_items_catalog_ref_check/);
  });

  it("migrates an existing database without touching its products", async () => {
    const path = join(tempDir(), "fpving.db");
    const folder = join(tempDir(), "drizzle");
    cpSync(APP_MIGRATIONS, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
      .parse(JSON.parse(readFileSync(journalPath, "utf8")));
    const before = journal.entries.findIndex((entry) => entry.tag.endsWith("gear_items"));
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, before) }));
    migrate(path, folder);
    const old = new Database(path);
    old.prepare("insert into products (id, name, created_at) values ('p1', 'Goggles', 1)").run();
    old.close();
    migrate(path);
    const { repository, close } = openSqliteRepository(path, recordingLogger());
    expect((await repository.products.get(productIdSchema.parse("p1")))?.name).toBe("Goggles");
    await repository.gear.add(pack);
    close();
  });

  it("logs and skips a stored row that is no longer a valid item when listing", async () => {
    const { repository, logger, path } = openTempSqlite();
    await repository.gear.add(pack);
    insertRaw(path, { ...row, specs_json: JSON.stringify({ cells: "secret-value" }) });
    expect((await repository.gear.list()).map((item) => item.id)).toEqual([pack.id]);
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]?.level).toBe("warn");
    expect(logger.events[0]?.fields?.["id"]).toBe("r1");
    expect(JSON.stringify(logger.events)).not.toContain("secret-value");
  });

  it("logs a stored row that is no longer a valid item and gives null when getting it", async () => {
    const { repository, logger, path } = openTempSqlite();
    insertRaw(path, { ...row, specs_json: JSON.stringify({ cells: "secret-value" }) });
    expect(await repository.gear.get(gearItemIdSchema.parse("r1"))).toBeNull();
    expect(logger.events.map((event) => event.level)).toEqual(["warn"]);
  });
});
