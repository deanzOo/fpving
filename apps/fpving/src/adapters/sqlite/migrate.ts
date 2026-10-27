import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate as applyMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const MIGRATIONS_TABLE = "__drizzle_migrations";

const lastAppliedMillis = (client: Database.Database): number | null => {
  const tracked = client.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(MIGRATIONS_TABLE);
  const lastMillis = (): unknown => client.prepare(`select max(created_at) from ${MIGRATIONS_TABLE}`).pluck().get();
  return tracked === undefined ? null : z.number().nullable().parse(lastMillis());
};

const backUp = (path: string): string => {
  const backupPath = `${path}.${new Date().toISOString().replaceAll(/[:.]/g, "-")}.bak`;
  copyFileSync(path, backupPath);
  return backupPath;
};

/**
 * Applies the pending migrations in `migrationsFolder` to the SQLite file at `path`, creating it when missing. An
 * existing file with pending migrations is first copied to a timestamped `.bak` file beside it. All pending
 * migrations run in one transaction, so a failure leaves the database as it was and throws, naming the backup.
 *
 * @param path - The database file.
 * @param migrationsFolder - The drizzle-kit migrations; the app's own by default.
 * @returns The backup's path, or null when none was needed.
 */
export const migrate = (path: string, migrationsFolder = MIGRATIONS_FOLDER): { backupPath: string | null } => {
  const existed = existsSync(path);
  const client = new Database(path);
  try {
    const last = lastAppliedMillis(client);
    const pending = readMigrationFiles({ migrationsFolder }).some((row) => last === null || row.folderMillis > last);
    const backupPath = existed && pending ? backUp(path) : null;
    try {
      applyMigrations(drizzle({ client }), { migrationsFolder });
    } catch (cause) {
      throw new Error(`Migrating ${path} failed and was rolled back; backup: ${backupPath ?? "none"}`, { cause });
    }
    return { backupPath };
  } finally {
    client.close();
  }
};
