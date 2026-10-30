import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, productIdSchema } from "@fpving/core";
import type { CurrencyRates, FxTable, Notifier, Scheduler } from "@fpving/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { migrate } from "../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../src/adapters/sqlite/repository.ts";
import type { ClosableBrowserDriver } from "../../src/adapters/transport/playwright-browser-driver.ts";
import { readAppVersion } from "../../src/adapters/transport/user-agent.ts";
import { DB_FILE, LOG_FILE, startApp, StartupErrorKind } from "../../src/app/start.ts";
import type { App, AppPorts } from "../../src/app/start.ts";
import { PLUGINS_FILE } from "../../src/plugins/config.ts";
import { HEALTH_PATH } from "../../src/server/health.ts";
import { fixturePlugin, spawnSourceWorker } from "../support/plugin-workers.ts";

const FAKE_KEY = "sk-ant-test-not-a-real-secret";
const OK = 200;
const PORT = 4321;
const PLUGIN_LOAD_MS = 20_000;
const OWNER_ONLY = 0o700;
const PERMISSIONS = 0o777;
const OPEN_DIR = 0o755;
const isWindows = process.platform === "win32";
const today = (): string => new Date().toISOString().slice(0, "yyyy-mm-dd".length);
const FX: FxTable = { base: "EUR", fetchedOn: "2026-01-01", ratesPerBase: { USD: 1.1 } };

let root = "";
let dataDir = "";
let app: App | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fpving-app-"));
  dataDir = join(root, "data");
});

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

const freePort = async (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = z.object({ port: z.number() }).parse(probe.address() satisfies AddressInfo | string | null);
      probe.close(() => {
        resolve(port);
      });
    });
  });

const env = (port = PORT): Record<string, string> => ({ PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: "debug" });

const fakes = () => {
  const order: string[] = [];
  const scheduler: Scheduler = {
    every: () => () => {
      order.push("scheduler");
    },
  };
  const browser: ClosableBrowserDriver = {
    fetchPage: async () => Promise.reject(new Error("no browser in tests")),
    close: async () => Promise.resolve(void order.push("browser")),
  };
  const fetchLatest = vi.fn<CurrencyRates["fetchLatest"]>(async () => Promise.resolve(ok(FX)));
  const rates: CurrencyRates = { fetchLatest };
  const notifier: Notifier = { notify: vi.fn(async () => Promise.resolve(ok(undefined))) };
  const ports: Partial<AppPorts> = { scheduler, browser, rates, notifier, spawn: spawnSourceWorker };
  return { order, ports, fetchLatest };
};

const started = async (source: Record<string, string>, overrides: Partial<AppPorts>): Promise<App> => {
  const result = await startApp(source, overrides);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  app = result.value;
  return app;
};

const health = async (running: App) =>
  running.server.inject({ method: "GET", url: HEALTH_PATH, headers: { host: `127.0.0.1:${String(PORT)}` } });

const logText = (): string => readFileSync(join(dataDir, LOG_FILE), "utf8");

describe("App startup", () => {
  it("wires every port into core and answers health with no plugins.json", async () => {
    const { ports } = fakes();
    const running = await started(env(), ports);
    const response = await health(running);
    expect(response.statusCode).toBe(OK);
    expect(response.json()).toEqual({ ok: true, version: readAppVersion(), plugins: { loaded: 0, disabled: 0 } });
    expect(Object.keys(running.deps).toSorted()).toEqual(
      ["clock", "ids", "llm", "logger", "notifier", "rates", "repository", "scheduler", "stores"],
    );
    expect(productIdSchema.safeParse(running.deps.ids.next()).success).toBe(true);
    expect(await running.deps.repository.settings.get()).toMatchObject({ shipToCountry: "IL" });
  });

  it("runs the boot scan through the injected ports, refreshing exchange rates first", async () => {
    const { ports, fetchLatest } = fakes();
    const running = await started(env(), ports);
    await running.scans.scanNow();
    expect(fetchLatest).toHaveBeenCalled();
    expect(await running.deps.repository.fxRates.latest()).toEqual(FX);
  });

  it("loads the plugins listed in plugins.json and counts rejected entries as disabled", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good"), { path: "relative/dir" }]));
    const { ports } = fakes();
    const running = await started(env(), ports);
    expect((await health(running)).json()).toMatchObject({ plugins: { loaded: 1, disabled: 1 } });
    expect(running.deps.stores.declaredDomains().length).toBeGreaterThan(0);
    expect(logText()).toContain("plugins.json entry rejected");
  }, PLUGIN_LOAD_MS);

  it("starts with no plugins and logs why when plugins.json is not valid JSON", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), "{ nope");
    const running = await started(env(), fakes().ports);
    expect((await health(running)).json()).toMatchObject({ plugins: { loaded: 0, disabled: 0 } });
    expect(logText()).toContain("plugins.json is unusable");
  });

  it("judges without the LLM when no API key is set, and says so once in the log", async () => {
    const running = await started(env(), fakes().ports);
    const judged = await running.deps.llm.compare("a", "b");
    expect(judged).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(logText()).toContain("no ANTHROPIC_API_KEY set");
  });

  it("wires the Anthropic judge when an API key is set, without logging the key", async () => {
    await started({ ...env(), ANTHROPIC_API_KEY: FAKE_KEY }, fakes().ports);
    expect(logText()).not.toContain("no ANTHROPIC_API_KEY set");
    expect(logText()).not.toContain(FAKE_KEY);
  });

  it.skipIf(isWindows)("creates DATA_DIR owner-only, and tightens an existing one", async () => {
    mkdirSync(dataDir, { mode: OPEN_DIR });
    await started(env(), fakes().ports);
    expect(statSync(dataDir).mode & PERMISSIONS).toBe(OWNER_ONLY);
  });

  it("runs on real adapters alone, reaching no network when the stored rates are fresh", async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error("network is off in tests")));
    vi.stubGlobal("fetch", fetch);
    mkdirSync(dataDir, { recursive: true });
    migrate(join(dataDir, DB_FILE));
    const seed = openSqliteRepository(join(dataDir, DB_FILE));
    await seed.repository.fxRates.save({ ...FX, fetchedOn: today() });
    seed.close();
    const running = await started(env(), {});
    await running.scans.scanNow();
    expect((await health(running)).statusCode).toBe(OK);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("listens on 127.0.0.1 at PORT", async () => {
    const port = await freePort();
    const running = await started(env(port), fakes().ports);
    expect(await running.listen()).toBe(`http://127.0.0.1:${String(port)}`);
    const response = await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`);
    expect(response.status).toBe(OK);
  });
});

describe("App startup failures", () => {
  it("refuses an invalid environment, naming the variable but never the key", async () => {
    const result = await startApp({ PORT: "1", DATA_DIR: dataDir, ANTHROPIC_API_KEY: FAKE_KEY });
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.InvalidEnv } });
    expect(JSON.stringify(result)).toContain("PORT");
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("refuses a DATA_DIR it cannot create", async () => {
    writeFileSync(join(root, "file"), "");
    dataDir = join(root, "file", "data");
    const result = await startApp(env(), fakes().ports);
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.DataDirFailed } });
  });

  it("refuses to start when the database cannot be migrated, and logs the detail", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, DB_FILE), "not a database, just text that is long enough to have a header page");
    const result = await startApp(env(), fakes().ports);
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.MigrateFailed } });
    expect(logText()).toContain("database migration failed");
  });
});

describe("App shutdown", () => {
  it("stops the schedule, closes the server, the browser and then the database, once", async () => {
    const { ports, order } = fakes();
    const running = await started(env(), ports);
    running.server.addHook("onClose", async () => Promise.resolve(void order.push("server")));
    expect(await running.shutdown()).toBe(true);
    expect(await running.shutdown()).toBe(true);
    expect(order).toEqual(["scheduler", "server", "browser"]);
    await expect(running.deps.repository.settings.get()).rejects.toThrow();
  });

  it("reports a failing step and still closes the rest", async () => {
    const { ports } = fakes();
    const browser: ClosableBrowserDriver = {
      fetchPage: async () => Promise.reject(new Error("unused")),
      close: async () => Promise.reject(new Error("browser stuck")),
    };
    const running = await started(env(), { ...ports, browser });
    expect(await running.shutdown()).toBe(false);
    await expect(running.deps.repository.settings.get()).rejects.toThrow();
    expect(logText()).toContain("browser stuck");
  });
});
