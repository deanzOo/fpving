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
  RouteHandle,
} from "../../../src/adapters/transport/playwright-browser-driver.ts";

const PROFILE = "/data/browser-profile";
const OK = 200;
const RELAUNCHED = 2;
const URL_IN = "https://shop.example/start";
const URL_OUT = "https://shop.example/final";

const REFUSED_URLS = [
  "file:///etc/passwd",
  "ftp://shop.example/file",
  "data:text/html,hi",
  "javascript:alert(1)",
  "http://localhost/",
  "http://127.0.0.1/",
  "http://10.1.2.3/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
];

interface FakePageSpec {
  readonly status?: number | null;
  readonly gotoError?: Error;
  readonly contentError?: Error;
  readonly closeError?: Error;
  readonly finalUrl?: string;
}

const harness = (spec: FakePageSpec = {}, launchError?: Error, launchGate?: Promise<void>) => {
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
    url: () => spec.finalUrl ?? URL_OUT,
    close: () => {
      log.push("page closed");
      return spec.closeError ? Promise.reject(spec.closeError) : Promise.resolve();
    },
  };
  const routes: { pattern: string; handler: (route: RouteHandle) => Promise<void> }[] = [];
  const context: BrowserContextHandle = {
    route: (pattern, handler) => {
      routes.push({ pattern, handler });
      log.push("route");
      return Promise.resolve();
    },
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
    const settled = launchError ? Promise.reject(launchError) : Promise.resolve(context);
    return launchGate ? launchGate.then(() => settled) : settled;
  };
  const seen: string[] = [];
  const limiter: DomainLimiter = {
    run: (url, task) => {
      seen.push(url);
      return task();
    },
  };
  const driver = createPlaywrightBrowserDriver({ launch, limiter, profileDir: PROFILE, allowPrivateHosts: true });
  const strict = createPlaywrightBrowserDriver({ launch, limiter, profileDir: PROFILE });
  return {
    driver,
    strict,
    log,
    gotos,
    dirs,
    seen,
    routes,
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
    expect(log).toEqual(["route", "goto", "content", "page closed"]);
  });

  it("closes the page when navigation fails", async () => {
    const { driver, log } = harness({ gotoError: new Error("net::ERR_CONNECTION_REFUSED") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(log).toEqual(["route", "goto", "page closed"]);
  });

  it("closes the page when reading the content fails", async () => {
    const { driver, log } = harness({ contentError: new Error("navigating") });
    const result = await driver.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(log).toEqual(["route", "goto", "content", "page closed"]);
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

  it("refuses pages after close and never launches again", async () => {
    const { driver, launches } = harness();
    await driver.fetchPage(URL_IN);
    await driver.close();
    expect(await driver.fetchPage(URL_IN)).toEqual({ ok: false, error: { kind: "network", detail: "browser closed" } });
    expect(launches()).toBe(1);
  });

  it("refuses pages after close even when none was ever loaded", async () => {
    const { driver, launches } = harness();
    await driver.close();
    expect(await driver.fetchPage(URL_IN)).toMatchObject({ ok: false, error: { detail: "browser closed" } });
    expect(launches()).toBe(0);
  });

  it("launches once when two first pages are wanted at the same time", async () => {
    const { driver, launches } = harness();
    const results = await Promise.all([driver.fetchPage(URL_IN), driver.fetchPage(URL_IN)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(launches()).toBe(1);
  });

  it("closes a context that finishes launching after close was called", async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { driver, contextCloses } = harness({}, undefined, gate);
    const page = driver.fetchPage(URL_IN);
    const closing = driver.close();
    finish();
    await closing;
    await page;
    expect(contextCloses()).toBe(1);
  });

  it("lets close finish when the launch it interrupted fails", async () => {
    let fail: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const { driver, contextCloses } = harness({}, new Error("executable doesn't exist"), gate);
    const page = driver.fetchPage(URL_IN);
    const closing = driver.close();
    fail();
    await expect(closing).resolves.toBeUndefined();
    expect(await page).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(contextCloses()).toBe(0);
  });

  it("keeps the original timeout when closing the page fails too", async () => {
    const { driver } = harness({
      gotoError: new errors.TimeoutError("Timeout 30000ms exceeded."),
      closeError: new Error("target closed"),
    });
    expect(await driver.fetchPage(URL_IN)).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it.each(REFUSED_URLS)("refuses %s as a network error before limiting or launching", async (url) => {
    const { strict, seen, launches } = harness();
    expect(await strict.fetchPage(url)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(seen).toEqual([]);
    expect(launches()).toBe(0);
  });

  it("loads the normalized url and limits on it, not the plugin's raw string", async () => {
    const { driver, gotos, seen } = harness();
    await driver.fetchPage("HTTPS://Shop.Example:443/a b");
    expect(gotos[0]?.url).toBe("https://shop.example/a%20b");
    expect(seen).toEqual(["https://shop.example/a%20b"]);
  });

  it("loads a private host only when private hosts are allowed", async () => {
    const { driver } = harness();
    expect(await driver.fetchPage("http://127.0.0.1:8080/")).toMatchObject({ ok: true });
  });

  it("routes every request the page makes through the url policy once the context is launched", async () => {
    const { strict, routes, log } = harness();
    await strict.fetchPage(URL_IN);
    expect(routes.map((route) => route.pattern)).toEqual(["**/*"]);
    expect(log[0]).toBe("route");
  });

  it.each([
    ["http://127.0.0.1:9/pixel.gif", false, "aborted"],
    ["http://[::1]/api", false, "aborted"],
    ["https://cdn.shop.example/app.js", false, "continued"],
    ["http://127.0.0.1:9/pixel.gif", true, "continued"],
  ])("lets a page request to %s through when private hosts allowed is %s: %s", async (url, allow, outcome) => {
    const { driver, strict, routes } = harness();
    await (allow ? driver : strict).fetchPage(URL_IN);
    const calls: string[] = [];
    const route: RouteHandle = {
      request: () => ({ url: () => url }),
      abort: () => {
        calls.push("aborted");
        return Promise.resolve();
      },
      continue: () => {
        calls.push("continued");
        return Promise.resolve();
      },
    };
    await routes[0]?.handler(route);
    expect(calls).toEqual([outcome]);
  });

  it("refuses a page whose navigation was redirected to a refused host", async () => {
    const { strict, log } = harness({ finalUrl: "http://127.0.0.1/admin" });
    const result = await strict.fetchPage(URL_IN);
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(result.ok ? "" : result.error.detail).toMatch(/^refused: .*; redirect to http:\/\/127\.0\.0\.1\/admin$/);
    expect(log).toEqual(["route", "goto", "page closed"]);
  });
});
