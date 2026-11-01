import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

const ACTION_TIMEOUT_MS = 2000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ["@fpving/source", ...defaultClientConditions], dedupe: ["react", "react-dom"] },
  build: { outDir: "dist/web", emptyOutDir: true },
  optimizeDeps: { entries: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"] },
  test: {
    name: "ui",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/support/console-guard.ts"],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({
        actionTimeout: ACTION_TIMEOUT_MS,
        contextOptions: { locale: "en-US", timezoneId: "Asia/Jerusalem" },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
