import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { parseEnv as parseDotenv } from "node:util";
import { parseEnv } from "../apps/fpving/src/config/env.ts";

/** The path prefix the dev server forwards to the app. */
export const API_PREFIX = "/api";

/**
 * The Vite dev server's proxy to the worktree's app. The port comes from `envFile` through the app's own `parseEnv`,
 * with a variable set in the shell winning, so an invalid or missing `.env` fails the same way and no value is ever
 * echoed. `changeOrigin` makes the Host header `127.0.0.1:PORT`. A request whose `Origin` is the dev page's own,
 * `http://<its Host>`, gets the app's origin instead, which is what the app's guard requires; any other `Origin` is
 * passed on untouched, so the app still refuses another site's changes, and Vite's own host check still refuses a
 * rebinding name.
 *
 * @param envFile - The worktree's `.env`; a missing file counts as empty.
 * @param shell - The process environment.
 * @returns The `server.proxy` entry for {@link API_PREFIX}.
 */
export const devProxy = (envFile: string, shell: Readonly<Record<string, string | undefined>>) => {
  const fromFile = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
  const env = parseEnv({ ...fromFile, ...shell });
  if (!env.ok) {
    throw new Error(env.error.message);
  }
  const target = `http://127.0.0.1:${String(env.value.PORT)}`;
  const bypass = (request: IncomingMessage): undefined => {
    if (request.headers.origin === `http://${String(request.headers.host)}`) {
      request.headers.origin = target;
    }
    return undefined;
  };
  return { [API_PREFIX]: { target, changeOrigin: true, bypass } };
};
