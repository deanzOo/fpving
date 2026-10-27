import { err, httpUrlSchema, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import { AddErrorKind } from "./errors.js";

const TRACKING_PARAMS = {
  names: ["gclid", "fbclid", "msclkid", "spm", "scm"],
  prefixes: ["utm_", "aff_"],
} as const;

const CANONICAL_SUBDOMAIN = /^(?:www|m)\./u;
const TRAILING_SLASHES = /(?<=.)\/+$/u;

/** The input is not an absolute http or https URL. */
export interface InvalidUrl {
  readonly kind: typeof AddErrorKind.InvalidUrl;
}

const isTracking = (name: string): boolean =>
  TRACKING_PARAMS.names.some((tracked) => tracked === name)
  || TRACKING_PARAMS.prefixes.some((prefix) => name.startsWith(prefix));

/**
 * The one form of a listing URL that every link to the same page shares, so a pasted link dedupes against the
 * listing already tracking it. Pure.
 *
 * @remarks
 * - The scheme and host are lowercased, the default port and the fragment dropped.
 * - Tracking parameters are dropped: `utm_*`, `aff_*`, `gclid`, `fbclid`, `msclkid`, `spm` and `scm`. The rest are
 *   sorted by name.
 * - Trailing slashes are stripped from the path, except the root `/`.
 * - A `www.` or `m.` subdomain is stripped only when the host left over is one of `declaredDomains`, the hostnames
 *   plugins declare, so `m.example.com` becomes `example.com` when a plugin declares `example.com`.
 *
 * @param url - The URL as the user pasted it.
 * @param declaredDomains - Every hostname a loaded plugin declares.
 * @returns The normalized URL, or `invalid_url` when `url` is not an absolute http or https URL.
 */
export const normalizeListingUrl = (url: string, declaredDomains: readonly string[]): Result<string, InvalidUrl> => {
  if (!httpUrlSchema.safeParse(url).success) {
    return err({ kind: AddErrorKind.InvalidUrl });
  }
  const parsed = new URL(url);
  const bareHost = parsed.hostname.replace(CANONICAL_SUBDOMAIN, "");
  if (declaredDomains.includes(bareHost)) {
    parsed.hostname = bareHost;
  }
  parsed.hash = "";
  for (const name of [...parsed.searchParams.keys()].filter(isTracking)) {
    parsed.searchParams.delete(name);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(TRAILING_SLASHES, "");
  return ok(parsed.href);
};
