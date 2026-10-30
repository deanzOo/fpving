import { fileURLToPath } from "node:url";
import { spawnWorker } from "../../src/plugins/runtime/host.ts";

/** Spawns workers from the TypeScript worker entry, resolving workspace packages to their sources. */
export const spawnSourceWorker = spawnWorker(new URL("../../src/plugins/runtime/worker-entry.ts", import.meta.url), [
  "--conditions=@fpving/source",
  "--import",
  new URL("./source-hooks.ts", import.meta.url).href,
]);

/** The folder of one fixture plugin under `test/fixtures/plugins`. */
export const fixturePlugin = (name: string): { readonly path: string } => ({
  path: fileURLToPath(new URL(`../fixtures/plugins/${name}`, import.meta.url)),
});
