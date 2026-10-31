import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ["@fpving/source", ...defaultClientConditions] },
  build: { outDir: "dist/web", emptyOutDir: true },
  test: {
    name: "ui",
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["apps/ui/test/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ contextOptions: { locale: "en-US" } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
