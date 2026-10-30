import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";
import { launchChromium } from "../../../src/adapters/transport/launch-chromium.ts";
import { createPlaywrightBrowserDriver } from "../../../src/adapters/transport/playwright-browser-driver.ts";
import type { ClosableBrowserDriver } from "../../../src/adapters/transport/playwright-browser-driver.ts";
import { NOT_FOUND, startLocalServer } from "../../support/local-server.ts";
import type { LocalServer } from "../../support/local-server.ts";

const BROWSER_TIMEOUT_MS = 60_000;
const OK = 200;
const RENDERED_HTML_MARKER = "<h1 id=\"title\">rendered</h1>";
const OPENER_AND_POPUP = 2;
const PUBLIC_NAME = "shop.test";

const launchResolvingPublicName = async (userDataDir: string) =>
  chromium.launchPersistentContext(userDataDir, {
    headless: true,
    serviceWorkers: "block",
    args: [`--host-resolver-rules=MAP ${PUBLIC_NAME} 127.0.0.1`],
  });

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

    describe("with a page that opens a popup", () => {
      let popupProfile: string;
      let popupDriver: ClosableBrowserDriver;
      let opened: BrowserContext | undefined;
      const pagesSeen: Page[] = [];
      let startingPages: Page[] = [];

      beforeAll(async () => {
        popupProfile = await mkdtemp(join(tmpdir(), "fpving-profile-"));
        popupDriver = createPlaywrightBrowserDriver({
          launch: async (userDataDir) => {
            const launched = await chromium.launchPersistentContext(userDataDir, { headless: true });
            launched.on("page", (page) => pagesSeen.push(page));
            opened = launched;
            startingPages = launched.pages();
            return launched;
          },
          limiter: instantLimiter,
          profileDir: popupProfile,
          allowPrivateHosts: true,
        });
      }, BROWSER_TIMEOUT_MS);

      afterAll(async () => {
        await popupDriver.close();
        await rm(popupProfile, { recursive: true, force: true });
      }, BROWSER_TIMEOUT_MS);

      it(
        "leaves only the pages the context started with once the fetch returns",
        async () => {
          const result = await popupDriver.fetchPage(`${server.origin}/popup-opener`);
          expect(result).toMatchObject({ ok: true, value: { status: OK } });
          expect(pagesSeen).toHaveLength(OPENER_AND_POPUP);
          expect(opened?.pages()).toEqual(startingPages);
        },
        BROWSER_TIMEOUT_MS,
      );
    });

    describe("with a page on a public name whose requests aim at a private host", () => {
      let privateServer: LocalServer;
      let pageServer: LocalServer;
      let strict: ClosableBrowserDriver;
      let strictProfile: string;
      const publicUrl = (path: string): string => `${pageServer.origin.replace("127.0.0.1", PUBLIC_NAME)}${path}`;

      beforeAll(async () => {
        strictProfile = await mkdtemp(join(tmpdir(), "fpving-profile-"));
        strict = createPlaywrightBrowserDriver({
          launch: launchResolvingPublicName,
          limiter: instantLimiter,
          profileDir: strictProfile,
        });
      }, BROWSER_TIMEOUT_MS);

      beforeEach(async () => {
        privateServer = await startLocalServer();
        pageServer = await startLocalServer({ target: privateServer.origin });
      });

      afterEach(async () => {
        await pageServer.close();
        await privateServer.close();
      });

      afterAll(async () => {
        await strict.close();
        await rm(strictProfile, { recursive: true, force: true });
      }, BROWSER_TIMEOUT_MS);

      it(
        "loads the page but blocks its image, script and fetch requests to the private host",
        async () => {
          const result = await strict.fetchPage(publicUrl("/leaky"));
          expect(result).toMatchObject({ ok: true, value: { status: OK } });
          expect(privateServer.requests).toEqual([]);
        },
        BROWSER_TIMEOUT_MS,
      );

      it(
        "lets the same requests through when private hosts are allowed, so the block above is real",
        async () => {
          const result = await driver.fetchPage(`${pageServer.origin}/leaky`);
          expect(result).toMatchObject({ ok: true });
          expect(privateServer.requests).toEqual(expect.arrayContaining(["/pixel", "/script.js"]));
        },
        BROWSER_TIMEOUT_MS,
      );

      it(
        "closes a WebSocket the page opens to the private host before it connects",
        async () => {
          const result = await strict.fetchPage(publicUrl("/socket-page"));
          expect(result).toMatchObject({ ok: true });
          const served = () => pageServer.requests;
          await expect.poll(served, { timeout: BROWSER_TIMEOUT_MS }).toContain("/socket-done");
          expect(privateServer.requests).not.toContain("upgrade /socket");
        },
        BROWSER_TIMEOUT_MS,
      );

      it(
        "lets the same WebSocket reach the private host when private hosts are allowed",
        async () => {
          await driver.fetchPage(`${pageServer.origin}/socket-page`);
          const upgrades = () => privateServer.requests;
          await expect.poll(upgrades, { timeout: BROWSER_TIMEOUT_MS }).toContain("upgrade /socket");
        },
        BROWSER_TIMEOUT_MS,
      );

      it(
        "refuses a navigation redirected to the private host instead of returning its page",
        async () => {
          const result = await strict.fetchPage(publicUrl("/redirect-to"));
          expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
        },
        BROWSER_TIMEOUT_MS,
      );
    });
  },
);
