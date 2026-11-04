import { z } from "zod";

const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "MPL-2.0",
  "OFL-1.1",
  "LGPL-3.0-or-later",
  "(MIT AND CC-BY-3.0)",
  "MIT AND ISC AND BSD-3-Clause",
]);

const listingSchema = z.record(z.string(), z.array(z.object({ name: z.string(), versions: z.array(z.string()) })));

/**
 * Checks the output of `pnpm licenses list -r --json`, every external dependency of every workspace package.
 *
 * @param raw - The parsed output.
 * @returns One `name@version: license` line per package version under a license that is not allowed.
 * @throws Error when the output is not the expected shape or lists no packages, so a broken scan cannot pass.
 */
export const licenseFindings = (raw: unknown): string[] => {
  const listing = Object.entries(listingSchema.parse(raw));
  if (listing.length === 0) {
    throw new Error("no packages in the license listing");
  }
  return listing
    .filter(([license]) => !ALLOWED_LICENSES.has(license))
    .flatMap(([license, packages]) => packages.flatMap(({ name, versions }) =>
      versions.map((version) => `${name}@${version}: ${license}`)));
};
