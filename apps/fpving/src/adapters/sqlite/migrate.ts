import { existsSync } from "node:fs";
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

const danglingKeys = (client: Database.Database): string | null => {
  const rows = z.array(z.object({ table: z.string() })).parse(client.pragma("foreign_key_check"));
  const tables = [...new Set(rows.map((row) => row.table))].join(", ");
  return rows.length === 0 ? null : `${String(rows.length)} dangling foreign key(s) (${tables})`;
};

const backUp = (client: Database.Database, path: string): string => {
  const backupPath = `${path}.${new Date().toISOString().replaceAll(/[:.]/g, "-")}.bak`;
  client.prepare("VACUUM INTO ?").run(backupPath);
  return backupPath;
};

/**
 * Applies the pending migrations in `migrationsFolder` to the SQLite file at `path`, creating it when missing. An
 * existing file with pending migrations is first copied with `VACUUM INTO` to a timestamped `.bak` file beside it,
 * which is consistent in any journal mode. All pending migrations run in one transaction, so a failure leaves the
 * database as it was and throws, naming the backup. Foreign keys are off while migrating, so a migration may rebuild a
 * referenced table; afterwards `foreign_key_check` must come back empty, or it throws, naming the backup, since those
 * migrations are already committed. Run it before opening any repository connection to the file.
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
    const backupPath = existed && pending ? backUp(client, path) : null;
    const backupNote = `backup: ${backupPath ?? "none"}`;
    client.pragma("foreign_keys = OFF");
    try {
      applyMigrations(drizzle({ client }), { migrationsFolder });
    } catch (cause) {
      throw new Error(`Migrating ${path} failed and was rolled back; ${backupNote}`, { cause });
    }
    const dangling = danglingKeys(client);
    if (dangling !== null) {
      throw new Error(`Migrating ${path} left ${dangling}; ${backupNote}`);
    }
    return { backupPath };
  } finally {
    client.close();
  }
};
