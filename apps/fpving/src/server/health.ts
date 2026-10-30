import { z } from "zod";
import type { PluginState } from "../plugins/runtime/host.js";
import { PluginStatusKind } from "../plugins/status.js";
import type { AppServer } from "./server.js";

/** Where the health route answers. */
export const HEALTH_PATH = "/api/health";

const HTTP_OK = 200;
const countSchema = z.int().nonnegative();

/** The health answer: the app version and how many plugins are loaded and disabled. */
export const healthSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
  plugins: z.object({ loaded: countSchema, disabled: countSchema }),
});

/** What the health route reads on each request. */
export interface HealthSource {
  readonly version: string;
  /** The plugin host's current plugin states. */
  plugins(): readonly PluginState[];
  /** How many `plugins.json` entries were rejected before reaching the host; they count as disabled. */
  rejectedEntries(): number;
}

/**
 * Adds `GET /api/health`, answering {@link healthSchema} from the plugin states at request time.
 *
 * @param server - The server to add the route to.
 * @param source - The version and the plugin states.
 */
export const registerHealthRoute = (server: AppServer, source: HealthSource): void => {
  server.get(HEALTH_PATH, { schema: { response: { [HTTP_OK]: healthSchema } } }, () => {
    const states = source.plugins();
    const loaded = states.filter(({ status }) => status.kind === PluginStatusKind.Loaded).length;
    return {
      ok: true,
      version: source.version,
      plugins: { loaded, disabled: states.length - loaded + source.rejectedEntries() },
    } as const;
  });
};
