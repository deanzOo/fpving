import { fileURLToPath } from "node:url";
import { spawnWorker } from "../../src/plugins/runtime/host.ts";
import type { SpawnWorker } from "../../src/plugins/runtime/connection.ts";

/** Spawns workers from the TypeScript worker entry, resolving workspace packages to their sources. */
export const spawnSourceWorker = spawnWorker(new URL("../../src/plugins/runtime/worker-entry.ts", import.meta.url), [
  "--conditions=@fpving/source",
  "--import",
  new URL("./source-hooks.ts", import.meta.url).href,
]);

/**
 * Spawns source workers that hand the `fixture-plugin` the local server's origin in `workerData`.
 *
 * @param fixtureOrigin - The local server's origin.
 * @returns The spawner.
 */
export const spawnSourceWorkerAt = (fixtureOrigin: string): SpawnWorker => (data) => {
  const withOrigin = { ...data, fixtureOrigin };
  return spawnSourceWorker(withOrigin);
};

/** The folder of one fixture plugin under `test/fixtures/plugins`. */
export const fixturePlugin = (name: string): { readonly path: string } => ({
  path: fileURLToPath(new URL(`../fixtures/plugins/${name}`, import.meta.url)),
});
