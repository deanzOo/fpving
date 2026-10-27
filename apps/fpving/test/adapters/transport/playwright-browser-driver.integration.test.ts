import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";
import { launchChromium } from "../../../src/adapters/transport/launch-chromium.ts";
import { createPlaywrightBrowserDriver } from "../../../src/adapters/transport/playwright-browser-driver.ts";
import type { ClosableBrowserDriver } from "../../../src/adapters/transport/playwright-browser-driver.ts";
import { NOT_FOUND, startLocalServer } from "../../support/local-server.ts";
import type { LocalServer } from "../../support/local-server.ts";

const BROWSER_TIMEOUT_MS = 60_000;
const OK = 200;
const RENDERED_HTML_MARKER = "<h1 id=\"title\">rendered</h1>";

const instantLimiter = createDomainLimiter({ now: () => Date.now(), sleep: () => Promise.resolve(), random: () => 0 });

const chromiumInstalled = existsSync(chromium.executablePath());
const browserRequired = process.env["FPVING_REQUIRE_BROWSER"] === "1";

describe("Chromium availability", () => {
  it.runIf(browserRequired)("is installed where CI requires the browser test", () => {
    expect(chromiumInstalled, "run `pnpm exec playwright install chromium`").toBe(true);
  });
});

describe.skipIf(!chromiumInstalled)(
  "The browser driver against a local server and real Chromium (skipped when the chromium binary is not installed)",
  () => {
    let server: LocalServer;
    let profileDir: string;
    let driver: ClosableBrowserDriver;

    beforeAll(async () => {
      server = await startLocalServer();
      profileDir = await mkdtemp(join(tmpdir(), "fpving-profile-"));
      driver = createPlaywrightBrowserDriver({
        launch: launchChromium,
        limiter: instantLimiter,
        profileDir,
        allowPrivateHosts: true,
      });
    }, BROWSER_TIMEOUT_MS);

    afterAll(async () => {
      await driver.close();
      await server.close();
      await rm(profileDir, { recursive: true, force: true });
    }, BROWSER_TIMEOUT_MS);

    it(
      "returns the rendered html, the status and the url after a redirect",
      async () => {
        const result = await driver.fetchPage(`${server.origin}/redirect`);
        expect(result).toMatchObject({
          ok: true,
          value: { status: OK, finalUrl: `${server.origin}/page` },
        });
        expect(result.ok ? result.value.html : "").toContain(RENDERED_HTML_MARKER);
      },
      BROWSER_TIMEOUT_MS,
    );

    it(
      "refuses a file url instead of reading the file",
      async () => {
        const strict = createPlaywrightBrowserDriver({ launch: launchChromium, limiter: instantLimiter, profileDir });
        expect(await strict.fetchPage("file:///etc/passwd")).toMatchObject({ ok: false, error: { kind: "network" } });
      },
      BROWSER_TIMEOUT_MS,
    );

    it(
      "returns a 404 page as a page",
      async () => {
        const result = await driver.fetchPage(`${server.origin}/missing`);
        expect(result).toMatchObject({ ok: true, value: { status: NOT_FOUND } });
      },
      BROWSER_TIMEOUT_MS,
    );
  },
);
