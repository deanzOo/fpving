import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { KEPT_BACKUPS, migrate } from "../../../src/adapters/sqlite/migrate.ts";
import * as schema from "../../../src/adapters/sqlite/schema.ts";
import { cleanUpTemp, tempDir } from "./temp-db.ts";

const APP_MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const JOURNAL = join("meta", "_journal.json");
const LATER = 1;

const journalSchema = z.looseObject({
  entries: z.array(z.looseObject({ idx: z.number(), when: z.number(), tag: z.string() })),
});

afterEach(cleanUpTemp);

const migrationsWith = (extraSql: string): string => {
  const folder = join(tempDir(), "drizzle");
  cpSync(APP_MIGRATIONS, folder, { recursive: true });
  const journal = journalSchema.parse(JSON.parse(readFileSync(join(folder, JOURNAL), "utf8")));
  const last = journal.entries.at(-1);
  const tag = "9999_extra";
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: (last?.when ?? 0) + LATER,
    tag,
    breakpoints: true,
  });
  writeFileSync(join(folder, JOURNAL), JSON.stringify(journal));
  writeFileSync(join(folder, `${tag}.sql`), extraSql);
  return folder;
};

const migrationsUpTo = (tag: string): string => {
  const folder = join(tempDir(), "drizzle");
  cpSync(APP_MIGRATIONS, folder, { recursive: true });
  const journal = journalSchema.parse(JSON.parse(readFileSync(join(folder, JOURNAL), "utf8")));
  const end = journal.entries.findIndex((entry) => entry.tag === tag) + 1;
  writeFileSync(join(folder, JOURNAL), JSON.stringify({ ...journal, entries: journal.entries.slice(0, end) }));
  return folder;
};

const tables = (path: string): string[] => {
  const client = new Database(path, { readonly: true });
  const names = z.array(z.string()).parse(
    client.prepare("select name from sqlite_master where type = 'table' order by name").pluck().all(),
  );
  client.close();
  return names;
};

const contents = (path: string): Record<string, unknown[]> => {
  const client = new Database(path, { readonly: true });
  const dump = Object.fromEntries(
    tables(path).map((table) => [table, client.prepare(`select * from ${table} order by rowid`).all()]),
  );
  client.close();
  return dump;
};

const seeded = (path: string): Record<string, unknown[]> => {
  migrate(path);
  const client = new Database(path);
  client.prepare("insert into fx_tables (base, rates_json, fetched_on) values ('USD', '{}', '2026-01-01')").run();
  client.close();
  return contents(path);
};

const snapshotSchema = z.looseObject({ tables: z.record(z.string(), z.unknown()) });

const backups = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith(".bak"));

describe("SQLite migrations", () => {
  it("match the schema the adapter declares, so no schema change is left without a migration", async () => {
    const meta = join(APP_MIGRATIONS, "meta");
    const latest = readdirSync(meta).filter((name) => name.endsWith("_snapshot.json")).toSorted().at(-1) ?? "";
    const committed = snapshotSchema.parse(JSON.parse(readFileSync(join(meta, latest), "utf8")));
    const declared: unknown = await generateSQLiteDrizzleJson(schema);
    expect(snapshotSchema.parse(declared).tables).toEqual(committed.tables);
  });

  it("creates every table in a new database file without making a backup", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    expect(migrate(path)).toEqual({ backupPath: null });
    expect(tables(path)).toEqual(expect.arrayContaining(["products", "listings", "price_snapshots", "settings"]));
    expect(backups(dir)).toEqual([]);
  });

  it("leaves an up-to-date database alone and makes no backup", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    migrate(path);
    const before = readFileSync(path);
    expect(migrate(path)).toEqual({ backupPath: null });
    expect(readFileSync(path)).toEqual(before);
    expect(backups(dir)).toEqual([]);
  });

  it("backs up an existing database before applying its pending migrations", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    const before = seeded(path);
    const { backupPath } = migrate(path, migrationsWith("CREATE TABLE `extra` (`id` integer PRIMARY KEY);"));
    expect(backupPath).not.toBeNull();
    expect(backups(dir)).toHaveLength(1);
    expect(contents(join(dir, backups(dir)[0] ?? ""))).toEqual(before);
    expect(tables(path)).toContain("extra");
  });

  it("keeps only the newest backups of its own file after migrating, leaving other files alone", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    seeded(path);
    const stamps = Array.from({ length: KEPT_BACKUPS + LATER }, (_, day) => `2026-01-0${String(day + LATER)}`);
    for (const stamp of stamps) {
      writeFileSync(`${path}.${stamp}T00-00-00-000Z.bak`, "");
    }
    writeFileSync(join(dir, "other.db.2026-01-01T00-00-00-000Z.bak"), "");
    const { backupPath } = migrate(path, migrationsWith("CREATE TABLE `extra` (`id` integer PRIMARY KEY);"));
    const kept = backups(dir).filter((name) => name.startsWith("fpving.db."));
    expect(kept).toHaveLength(KEPT_BACKUPS);
    expect(kept).toContain(basename(backupPath ?? ""));
    expect(kept).not.toContain(`fpving.db.${stamps[0] ?? ""}T00-00-00-000Z.bak`);
    expect(kept).not.toContain(`fpving.db.${stamps[1] ?? ""}T00-00-00-000Z.bak`);
    expect(backups(dir)).toContain("other.db.2026-01-01T00-00-00-000Z.bak");
  });

  it("prunes only regular files named like its own backups, so a user's .bak or a folder survives", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    seeded(path);
    const stamped = (day: number): string => `fpving.db.2026-01-0${String(day)}T00-00-00-000Z.bak`;
    for (let day = 1; day <= KEPT_BACKUPS + LATER; day += 1) {
      writeFileSync(join(dir, stamped(day)), "");
    }
    writeFileSync(join(dir, "fpving.db.0-mine.bak"), "mine");
    writeFileSync(join(dir, "fpving.db.manual.bak"), "mine");
    mkdirSync(join(dir, "fpving.db.2025-01-01T00-00-00-000Z.bak"));
    migrate(path, migrationsWith("CREATE TABLE `extra` (`id` integer PRIMARY KEY);"));
    const names = readdirSync(dir);
    expect(names).toEqual(expect.arrayContaining(["fpving.db.0-mine.bak", "fpving.db.manual.bak"]));
    expect(names).toContain("fpving.db.2025-01-01T00-00-00-000Z.bak");
    expect(names).not.toContain(stamped(1));
    expect(names).not.toContain(stamped(LATER + 1));
  });

  it("never prunes the backup it just made, even when the clock went backwards", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    seeded(path);
    const future = (year: number): string => `fpving.db.${String(year)}-01-01T00-00-00-000Z.bak`;
    const FUTURE_YEAR = 2990;
    for (let offset = 0; offset < KEPT_BACKUPS; offset += 1) {
      writeFileSync(join(dir, future(FUTURE_YEAR + offset)), "");
    }
    const { backupPath } = migrate(path, migrationsWith("CREATE TABLE `extra` (`id` integer PRIMARY KEY);"));
    const kept = backups(dir);
    expect(kept).toHaveLength(KEPT_BACKUPS);
    expect(kept).toContain(basename(backupPath ?? ""));
    expect(kept).not.toContain(future(FUTURE_YEAR));
  });

  it("rolls back a failing migration, keeps the backup intact and names it in the error", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    const before = seeded(path);
    const broken = migrationsWith("CREATE TABLE `half` (`id` integer);\n--> statement-breakpoint\nNOT SQL;");
    expect(() => migrate(path, broken)).toThrow(/^Migrating .* failed and was rolled back; backup: .*\.bak$/);
    const [backup] = backups(dir);
    expect(contents(join(dir, backup ?? ""))).toEqual(before);
    expect(contents(path)).toEqual(before);
    expect(tables(path)).not.toContain("half");
  });

  it("rebuilds a table other tables reference while they hold rows pointing at it", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    migrate(path);
    const client = new Database(path);
    client.prepare("insert into products (id, name, created_at) values ('p1', 'Goggles', 1)").run();
    client
      .prepare(
        "insert into listings (id, product_id, plugin_id, url, title, status, origin, added_at, failure_streak, "
        + "not_found_streak) values ('l1', 'p1', 'shop', 'https://shop.example/1', 'Goggles', 'active', 'manual', 1, 0, 0)",
      )
      .run();
    client.close();
    const rebuild = [
      "CREATE TABLE `__new_products` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, "
      + "`created_at` integer NOT NULL, `archived_at` integer, `cheapest_listing_id` text, "
      + "FOREIGN KEY (`cheapest_listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE restrict);",
      "INSERT INTO `__new_products` SELECT * FROM `products`;",
      "DROP TABLE `products`;",
      "ALTER TABLE `__new_products` RENAME TO `products`;",
    ].join("\n--> statement-breakpoint\n");
    expect(migrate(path, migrationsWith(rebuild)).backupPath).not.toBeNull();
    expect(contents(path)["listings"]).toHaveLength(1);
    expect(contents(path)["products"]).toEqual([expect.objectContaining({ id: "p1" })]);
  });

  it("lets an existing database's listings be removed, keeping every row and still refusing an unknown status", () => {
    const path = join(tempDir(), "fpving.db");
    migrate(path, migrationsUpTo("0000_init"));
    const client = new Database(path);
    client.prepare("insert into products (id, name, created_at) values ('p1', 'Goggles', 1)").run();
    const insertListing = client.prepare(
      "insert into listings (id, product_id, plugin_id, url, title, status, origin, added_at, failure_streak, "
      + "not_found_streak) values (?, 'p1', 'shop', ?, 'Goggles', ?, 'manual', 1, 0, 0)",
    );
    insertListing.run("l1", "https://shop.example/1", "active");
    expect(() => insertListing.run("l2", "https://shop.example/2", "removed")).toThrow(/CHECK/u);
    client.close();
    migrate(path);
    const after = new Database(path);
    after.pragma("foreign_keys = ON");
    after.prepare("update listings set status = 'removed' where id = 'l1'").run();
    expect(() => after.prepare("update listings set status = 'deleted' where id = 'l1'").run()).toThrow(/CHECK/u);
    after
      .prepare("insert into price_snapshots values ('s1', 'l1', 1, 'IL', 100, 'USD', 'unknown', null, null, 1)")
      .run();
    after.close();
    expect(contents(path)["listings"]).toEqual([expect.objectContaining({ id: "l1", status: "removed" })]);
  });

  it("refuses a migration that leaves a dangling foreign key, naming the backup it kept", () => {
    const dir = tempDir();
    const path = join(dir, "fpving.db");
    seeded(path);
    const dangling
      = "INSERT INTO `listings` (`id`, `product_id`, `plugin_id`, `url`, `title`, `status`, `origin`, `added_at`, "
        + "`failure_streak`, `not_found_streak`) VALUES ('l1', 'missing', 'shop', 'https://shop.example/1', 'Goggles', "
        + "'active', 'manual', 1, 0, 0);";
    expect(() => migrate(path, migrationsWith(dangling))).toThrow(
      /^Migrating .* left 1 dangling foreign key\(s\) \(listings\); backup: .*\.bak$/,
    );
    expect(backups(dir)).toHaveLength(1);
  });

  it("reports that no backup exists when migrating a new database file fails", () => {
    const path = join(tempDir(), "fpving.db");
    expect(() => migrate(path, migrationsWith("NOT SQL;"))).toThrow(/backup: none$/);
  });
});
