import { readFileSync } from "node:fs";
import { z } from "zod";

/** Where the project lives, so a shop owner who sees the traffic can find who is behind it. */
export const REPO_URL = "https://github.com/deanzOo/fpving";

const packageSchema = z.object({ version: z.string().min(1) });

/**
 * Builds the user agent every host request carries.
 *
 * @param version - The app version.
 * @returns `fpving/<version> (+<repository url>)`.
 */
export const createUserAgent = (version: string): string => `fpving/${version} (+${REPO_URL})`;

/**
 * Reads the version from the app's `package.json`, which sits three levels above this file in both `src` and `dist`.
 *
 * @returns The version string.
 */
export const readAppVersion = (): string =>
  packageSchema.parse(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))).version;
