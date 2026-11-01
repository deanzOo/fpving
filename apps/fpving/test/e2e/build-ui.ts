import { fileURLToPath } from "node:url";
import { build } from "vite";

const UI_DIR = fileURLToPath(new URL("../../../ui", import.meta.url));

/** Builds the UI into `apps/ui/dist/web`, the folder the app serves, exactly as `pnpm build` does. */
export default async function buildUi(): Promise<void> {
  await build({ root: UI_DIR, configFile: `${UI_DIR}/vite.config.ts`, logLevel: "error" });
}
