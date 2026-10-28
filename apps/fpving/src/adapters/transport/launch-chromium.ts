import { chromium } from "playwright";
import type { LaunchContext } from "./playwright-browser-driver.js";

/**
 * Opens Chromium with a persistent profile, headless, with service workers blocked so that every request a page makes
 * reaches the driver's route. It needs the browser binary from `playwright install`.
 */
export const launchChromium: LaunchContext = async (userDataDir) =>
  chromium.launchPersistentContext(userDataDir, { headless: true, serviceWorkers: "block" });
