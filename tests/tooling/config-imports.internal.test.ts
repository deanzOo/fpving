import { describe, expect, it } from "vitest";
import { importsReachableFrom } from "../../tools/imports-reachable.ts";

const WORKSPACE_SCOPE = "@fpving/";

const CONFIGS = [
  "vitest.config.ts",
  "eslint.config.ts",
  "commitlint.config.ts",
  "apps/ui/vite.config.ts",
  "apps/fpving/drizzle.config.ts",
  "apps/docs/astro.config.ts",
] as const;

describe("Config files", () => {
  it.each(CONFIGS)("%s loads before any build: no static import reaches a workspace package", (config) => {
    const reached = [...importsReachableFrom(new URL(`../../${config}`, import.meta.url))];
    expect(reached.filter((specifier) => specifier.startsWith(WORKSPACE_SCOPE))).toEqual([]);
  });
});
