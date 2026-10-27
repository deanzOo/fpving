import { errors } from "playwright";
import { describe, expect, it } from "vitest";
import type { DomainLimiter } from "../../../src/adapters/transport/domain-limiter.ts";
import {
  createPlaywrightBrowserDriver,
  NAVIGATION_TIMEOUT_MS,
} from "../../../src/adapters/transport/playwright-browser-driver.ts";
import type {
  BrowserContextHandle,
  BrowserPageHandle,
  LaunchContext,
} from "../../../src/adapters/transport/playwright-browser-driver.ts";

const PROFILE = "/data/browser-profile";
const OK = 200;
const RELAUNCHED = 2;
const URL_IN = "https://shop.example/start";
const URL_OUT = "https://shop.example/final";

interface FakePageSpec {
  readonly status?: number | null;
  readonly gotoError?: Error;
  readonly contentError?: Error;
  readonly closeError?: Error;
}

const harness = (spec: FakePageSpec = {}, launchError?: Error) => {
  const log: string[] = [];
  const gotos: { url: string; options: { timeout: number; waitUntil: string } }[] = [];
  let launches = 0;
  let contextCloses = 0;
  const page: BrowserPageHandle = {
    goto: (url, options) => {
      gotos.push({ url, options });
      log.push("goto");
      if (spec.gotoError) {
        return Promise.reject(spec.gotoError);
      }
      const status = spec.status === undefined ? OK : spec.status;
      return Promise.resolve(status === null ? null : { status: () => status });
    },
    content: () => {
      log.push("content");
      return spec.contentError ? Promise.reject(spec.contentError) : Promise.resolve("<html>hi</html>");
    },
    url: () => URL_OUT,
    close: () => {
      log.push("page closed");
      return spec.closeError ? Promise.reject(spec.closeError) : Promise.resolve();
    },
  };
  const context: BrowserContextHandle = {
    newPage: () => Promise.resolve(page),
    close: () => {
      contextCloses += 1;
      return Promise.resolve();
    },
  };
  const dirs: string[] = [];
  const launch: LaunchContext = (dir) => {
    launches += 1;
    dirs.push(dir);
    return launchError ? Promise.reject(launchError) : Promise.resolve(context);
  };
  const seen: string[] = [];
  const limiter: DomainLimiter = {
    run: (url, task) => {
      seen.push(url);
      return task();
    },
  };
  const driver = createPlaywrightBrowserDriver({ launch, limiter, profileDir: PROFILE });
  return {
    driver,
    log,
    gotos,
    dirs,
    seen,
    launches: () => launches,
    contextCloses: () => contextCloses,
  };
};

describe("Rendering pages in the host browser", () => {
  it("returns the status, html and final url of the loaded page", async () => {
    const { driver } = harness();
    expect(await driver.fetchPage(URL_IN)).toEqual({
      ok: true,
      value: { status: OK, html: "<html>hi</html>", finalUrl: URL_OUT },
    });
  });

  it("navigates with the page timeout", async () => {
    const { driver, gotos } = harness();
    await driver.fetchPage(URL_IN);
    expect(gotos).toEqual([{ url: URL_IN, options: { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "load" } }]);
  });

  it("goes through the limiter keyed by the url", async () => {
    const { driver, seen } = harness();
    await driver.fetchPage(URL_IN);
    expect(seen).toEqual([URL_IN]);
  });

  it("launches nothing until the first page is wanted, then reuses one context", async () => {
    const { driver, launches, dirs } = harness();
    expect(launches()).toBe(0);
    await driver.fetchPage(URL_IN);
    await driver.fetchPage(URL_IN);
    expect(launches()).toBe(1);
    expect(dirs).toEqual([PROFILE]);
  });

  it("closes the page after a successful load", async () => {
    const { driver, log } = harness();
    await driver.fetchPage(URL_IN);
    expect(log).toEqual(["goto", "content", "page closed"]);
  });

  it("closes the page when navigation fails", async () => {
    const { driver, log } = harness({ gotoError: new Error("net::ERR_CONNECTION_REFUSED") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(log).toEqual(["goto", "page closed"]);
  });

  it("closes the page when reading the content fails", async () => {
    const { driver, log } = harness({ contentError: new Error("navigating") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(log).toEqual(["goto", "content", "page closed"]);
  });

  it("maps a Playwright timeout to a timeout error", async () => {
    const { driver } = harness({ gotoError: new errors.TimeoutError("Timeout 30000ms exceeded.") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("does not treat an error that only says timeout as one", async () => {
    const { driver } = harness({ gotoError: new Error("TimeoutError: lookalike") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("reports a navigation without a response as a network error", async () => {
    const { driver } = harness({ status: null });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toEqual({ ok: false, error: { kind: "network", detail: "navigation produced no response" } });
  });

  it("returns a 404 page as a page", async () => {
    const { driver } = harness({ status: 404 });
    expect(await driver.fetchPage(URL_IN)).toMatchObject({ ok: true, value: { status: 404 } });
  });

  it("maps a failed page close to a network error", async () => {
    const { driver } = harness({ closeError: new Error("target closed") });
    expect(await driver.fetchPage(URL_IN)).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("maps a failed launch to a network error and tries again on the next call", async () => {
    const failing = harness({}, new Error("executable doesn't exist"));
    expect(await failing.driver.fetchPage(URL_IN)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(await failing.driver.fetchPage(URL_IN)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(failing.launches()).toBe(RELAUNCHED);
  });

  it("closes the context once and ignores further closes", async () => {
    const { driver, contextCloses } = harness();
    await driver.fetchPage(URL_IN);
    await driver.close();
    await driver.close();
    expect(contextCloses()).toBe(1);
  });

  it("closes without launching when no page was ever wanted", async () => {
    const { driver, launches, contextCloses } = harness();
    await driver.close();
    expect(launches()).toBe(0);
    expect(contextCloses()).toBe(0);
  });

  it("launches a fresh context for a page wanted after close", async () => {
    const { driver, launches } = harness();
    await driver.fetchPage(URL_IN);
    await driver.close();
    await driver.fetchPage(URL_IN);
    expect(launches()).toBe(RELAUNCHED);
  });
});
