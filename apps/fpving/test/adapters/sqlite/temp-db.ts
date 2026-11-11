import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repository } from "@fpving/core";
import { migrate } from "../../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../../src/adapters/sqlite/repository.ts";
import { recordingLogger } from "../../support/recording-logger.ts";

const cleanups: (() => void)[] = [];

/** A fresh temp directory, removed by {@link cleanUpTemp}. */
export const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fpving-db-"));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

/** A migrated, empty repository on a new SQLite file with its logger, cleaned up by {@link cleanUpTemp}. */
export const openTempSqlite = (): {
  repository: Repository;
  logger: ReturnType<typeof recordingLogger>;
  path: string;
} => {
  const path = join(tempDir(), "fpving.db");
  migrate(path);
  const logger = recordingLogger();
  const { repository, close } = openSqliteRepository(path, logger);
  cleanups.unshift(close);
  return { repository, logger, path };
};

/** A migrated, empty repository on a new SQLite file, closed and deleted by {@link cleanUpTemp}. */
export const openTempSqliteRepository = async (): Promise<Repository> => Promise.resolve(openTempSqlite().repository);

/** Closes every temp database and deletes every temp directory. */
export const cleanUpTemp = (): void => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
};
