import { defineConfig } from "vitest/config";
import { SpecReporter } from "./tools/spec-reporter.ts";

const FULL = 100;
const SOURCE_CONDITIONS = ["@fpving/source"];

export default defineConfig({
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
  test: {
    reporters: ["default", new SpecReporter()],
    projects: [
      { extends: true, test: { name: "core", root: "packages/core", include: ["test/**/*.test.ts"] } },
      { extends: true, test: { name: "plugin-sdk", root: "packages/plugin-sdk", include: ["test/**/*.test.ts"] } },
      { extends: true, test: { name: "app", root: "apps/fpving", include: ["test/**/*.test.ts"] } },
      { extends: true, test: { name: "tooling", include: ["tests/tooling/**/*.test.ts", "tools/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "packages/core/eval/**/*.ts", "apps/*/src/**", "tools/**"],
      exclude: [
        "**/*.test.ts",
        "**/fixtures/**",
        "packages/*/src/index.ts",
        "packages/plugin-sdk/src/contract/index.ts",
        "packages/plugin-sdk/src/contract/check.ts",
        "packages/core/src/testing/index.ts",
        "apps/*/src/index.ts",
        "apps/fpving/src/main.ts",
        "apps/fpving/src/adapters/transport/launch-chromium.ts",
        "apps/fpving/src/plugins/runtime/worker-entry.ts",
        "tools/*-cli.ts",
        "apps/docs/**",
      ],
      thresholds: { lines: FULL, branches: FULL, functions: FULL, statements: FULL },
    },
  },
});
