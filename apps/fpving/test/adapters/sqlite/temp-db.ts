import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repository } from "@fpving/core";
import { migrate } from "../../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../../src/adapters/sqlite/repository.ts";

const cleanups: (() => void)[] = [];

/** A fresh temp directory, removed by {@link cleanUpTemp}. */
export const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fpving-db-"));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

/** A migrated, empty repository on a new SQLite file, closed and deleted by {@link cleanUpTemp}. */
export const openTempSqliteRepository = async (): Promise<Repository> => {
  const path = join(tempDir(), "fpving.db");
  migrate(path);
  const { repository, close } = openSqliteRepository(path);
  cleanups.unshift(close);
  return Promise.resolve(repository);
};

/** Closes every temp database and deletes every temp directory. */
export const cleanUpTemp = (): void => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
};
