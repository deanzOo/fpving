import { chromium } from "playwright";
import type { LaunchContext } from "./playwright-browser-driver.js";

/**
 * Opens Chromium with a persistent profile, headless, with service workers blocked, because their requests would bypass
 * the driver's routes. It needs the browser binary from `playwright install`.
 */
export const launchChromium: LaunchContext = async (userDataDir) =>
  chromium.launchPersistentContext(userDataDir, { headless: true, serviceWorkers: "block" });
