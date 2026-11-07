import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { SpecReporter } from "./tools/spec-reporter.ts";

const FULL = 100;
const SOURCE_CONDITIONS = ["@fpving/source"];
const E2E_TIMEOUT_MS = 180_000;
const APP_TIMEOUT_MS = 30_000;
const E2E_TESTS = "test/e2e/**/*.test.ts";
const UI_ROOT = "apps/ui";
const UI_3D_TIMEOUT_MS = 60_000;
const UI_3D_POLL_MS = 20_000;
const UI_CONFIG = "apps/ui/vite.config.ts";
const UI_3D_TESTS = "test/3d/**/*.test.{ts,tsx}";

export default defineConfig({
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
  test: {
    reporters: ["default", new SpecReporter()],
    projects: [
      { extends: true, test: { name: "core", dir: "packages/core", include: ["test/**/*.test.ts"] } },
      { extends: true, test: { name: "plugin-sdk", dir: "packages/plugin-sdk", include: ["test/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "app",
          dir: "apps/fpving",
          testTimeout: APP_TIMEOUT_MS,
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, E2E_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          dir: "apps/fpving",
          include: [E2E_TESTS],
          globalSetup: [fileURLToPath(new URL("apps/fpving/test/e2e/build-ui.ts", import.meta.url))],
          testTimeout: E2E_TIMEOUT_MS,
          hookTimeout: E2E_TIMEOUT_MS,
        },
      },
      {
        extends: UI_CONFIG,
        root: UI_ROOT,
        test: {
          name: "ui",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, UI_3D_TESTS],
        },
      },
      {
        extends: UI_CONFIG,
        root: UI_ROOT,
        test: {
          name: "ui-3d",
          include: [UI_3D_TESTS],
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
          testTimeout: UI_3D_TIMEOUT_MS,
          expect: { poll: { timeout: UI_3D_POLL_MS } },
        },
      },
      { extends: true, test: { name: "tooling", include: ["tests/tooling/**/*.test.ts", "tools/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "packages/core/eval/**/*.ts", "apps/*/src/**", "tools/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/fixtures/**",
        "packages/*/src/index.ts",
        "packages/plugin-sdk/src/contract/index.ts",
        "packages/plugin-sdk/src/contract/check.ts",
        "packages/core/src/testing/index.ts",
        "apps/*/src/index.ts",
        "apps/fpving/src/main.ts",
        "apps/ui/src/main.tsx",
        "apps/fpving/src/adapters/transport/launch-chromium.ts",
        "apps/fpving/src/plugins/runtime/worker-entry.ts",
        "tools/*-cli.ts",
        "apps/docs/**",
      ],
      thresholds: { lines: FULL, branches: FULL, functions: FULL, statements: FULL },
    },
  },
});
