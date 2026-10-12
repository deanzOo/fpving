import { defineConfig } from "vitest/config";
import { SpecReporter } from "./tools/spec-reporter.ts";

const FULL = 100;

export default defineConfig({
  test: {
    reporters: ["default", new SpecReporter()],
    projects: [
      { test: { name: "core", root: "packages/core", include: ["test/**/*.test.ts"] } },
      { test: { name: "plugin-sdk", root: "packages/plugin-sdk", include: ["test/**/*.test.ts"] } },
      { test: { name: "app", root: "apps/fpving", include: ["test/**/*.test.ts"] } },
      { test: { name: "tooling", include: ["tests/tooling/**/*.test.ts", "tools/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**", "tools/**"],
      exclude: ["**/*.test.ts", "**/fixtures/**", "packages/*/src/index.ts", "apps/*/src/index.ts"],
      thresholds: { lines: FULL, branches: FULL, functions: FULL, statements: FULL },
    },
  },
});
