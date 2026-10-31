import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";
import { devProxy } from "../../tools/dev-proxy.ts";

const ACTION_TIMEOUT_MS = 2000;
const DEV_MODE = "development";

export default defineConfig(({ command, mode }) => ({
  server: command === "serve" && mode === DEV_MODE
    ? { proxy: devProxy(fileURLToPath(new URL("../../.env", import.meta.url)), process.env) }
    : {},
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ["@fpving/source", ...defaultClientConditions], dedupe: ["react", "react-dom"] },
  build: { outDir: "dist/web", emptyOutDir: true },
  optimizeDeps: { entries: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"] },
  test: {
    name: "ui",
    include: ["test/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ actionTimeout: ACTION_TIMEOUT_MS, contextOptions: { locale: "en-US" } }),
      instances: [{ browser: "chromium" }],
    },
  },
}));
