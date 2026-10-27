import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate } from "../../../src/adapters/sqlite/migrate.ts";
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

  it("reports that no backup exists when migrating a new database file fails", () => {
    const path = join(tempDir(), "fpving.db");
    expect(() => migrate(path, migrationsWith("NOT SQL;"))).toThrow(/backup: none$/);
  });
});
