import { readFileSync } from "node:fs";

const IMPORT = /^(?:import|export)\b[^;]*from "([^"]+)";$/gm;

/**
 * Every bare package specifier and every relative module href reachable by following the static imports and
 * re-exports of `file`, so a test can prove a published entry never loads a package such as `vitest`.
 */
export const importsReachableFrom = (file: URL, seen = new Set<string>()): Set<string> => {
  for (const [, specifier = ""] of readFileSync(file, "utf8").matchAll(IMPORT)) {
    if (!specifier.startsWith(".")) {
      seen.add(specifier);
      continue;
    }
    const next = new URL(specifier.replace(/\.js$/, ".ts"), file);
    if (seen.has(next.href)) continue;
    seen.add(next.href);
    importsReachableFrom(next, seen);
  }
  return seen;
};
