import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productIdSchema } from "@fpving/core";
import type { Scheduler, Settings } from "@fpving/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { migrate } from "../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../src/adapters/sqlite/repository.ts";
import type { ClosableBrowserDriver } from "../../src/adapters/transport/playwright-browser-driver.ts";
import { readAppVersion } from "../../src/adapters/transport/user-agent.ts";
import { DB_FILE, isOpenToOthers, LOG_FILE, startApp, StartupErrorKind } from "../../src/app/start.ts";
import type { App, AppPorts } from "../../src/app/start.ts";
import { PLUGINS_FILE } from "../../src/plugins/config.ts";
import type { SpawnWorker } from "../../src/plugins/runtime/connection.ts";
import { HEALTH_PATH } from "../../src/server/health.ts";
import { apiRoutes } from "../../src/server/api-routes.ts";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";
import { fakeWorker } from "../plugins/runtime/fake-worker.ts";
import { fakePorts, freePort, FX, occupy } from "../support/app-fixtures.ts";
import { fixturePlugin } from "../support/plugin-workers.ts";

const FAKE_KEY = "sk-ant-test-not-a-real-secret";
const OK = 200;
const NOT_FOUND = 404;
const UNAVAILABLE = 503;
const PLUGIN_LOAD_MS = 20_000;
const MS_PER_HOUR = 3_600_000;
const ACCEPTED = 202;
const INTERNAL_ERROR = 500;
const OWNER_ONLY = 0o700;
const PERMISSIONS = 0o777;
const OPEN_DIR = 0o755;
const GROUP_READABLE = 0o750;
const isWindows = process.platform === "win32";
const today = (): string => new Date().toISOString().slice(0, "yyyy-mm-dd".length);

let root = "";
let dataDir = "";
let port = 0;
let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "fpving-app-"));
  dataDir = join(root, "data");
  port = await freePort();
});

const env = (): Record<string, string> => ({ PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: "debug" });
const healthUrl = (): string => `http://127.0.0.1:${String(port)}${HEALTH_PATH}`;

const fakes = fakePorts;

const started = async (source: Record<string, string>, overrides: Partial<AppPorts>): Promise<App> => {
  const result = await startApp(source, overrides);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  app = result.value;
  return app;
};

const host = () => ({ host: `127.0.0.1:${String(port)}` });

const health = async (running: App) => running.server.inject({ method: "GET", url: HEALTH_PATH, headers: host() });

const logText = (): string => readFileSync(join(dataDir, LOG_FILE), "utf8");

const readyWorkers = () => {
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const spawn: SpawnWorker = (data) => {
    const worker = fakeWorker(data);
    workers.push(worker);
    queueMicrotask(() => {
      worker.ready();
    });
    return worker.handle;
  };
  return { workers, spawn };
};

describe("App startup", () => {
  it("wires every port into core and answers health with no plugins.json", async () => {
    const { ports } = fakes();
    const running = await started(env(), ports);
    const response = await health(running);
    expect(response.statusCode).toBe(OK);
    expect(response.json()).toEqual({
      ok: true,
      ready: true,
      version: readAppVersion(),
      plugins: { loaded: 0, disabled: 0 },
    });
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
    const rows = await running.server.inject({ method: "GET", url: apiRoutes.listPlugins.url, headers: host() });
    expect(z.array(z.object({ source: z.string(), status: z.string() })).parse(rows.json())).toEqual([
      { source: fixturePlugin("good").path, status: PluginStatusKind.Loaded },
      { source: `${PLUGINS_FILE}[1]`, status: PluginStatusKind.Disabled },
    ]);
    expect(logText()).toContain("plugins.json entry rejected");
  }, PLUGIN_LOAD_MS);

  it("starts with no plugins and lists an unusable plugins.json as one disabled row", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), "{ nope");
    const running = await started(env(), fakes().ports);
    expect((await health(running)).json()).toMatchObject({ plugins: { loaded: 0, disabled: 1 } });
    expect(logText()).toContain("plugins.json is unusable");
    const rows = await running.server.inject({ method: "GET", url: apiRoutes.listPlugins.url, headers: host() });
    const row = z.object({ source: z.string(), status: z.string(), issues: z.array(z.object({ kind: z.string() })) });
    expect(z.array(row).parse(rows.json())).toEqual([{
      source: PLUGINS_FILE,
      status: PluginStatusKind.Disabled,
      issues: [{ kind: PluginIssueKind.ConfigInvalid }],
    }]);
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

  it.skipIf(isWindows)("creates DATA_DIR owner-only", async () => {
    await started(env(), fakes().ports);
    expect(statSync(dataDir).mode & PERMISSIONS).toBe(OWNER_ONLY);
  });

  it("warns when an existing DATA_DIR is open to other users on a POSIX system, on every OS", async () => {
    mkdirSync(dataDir, { mode: OPEN_DIR });
    chmodSync(dataDir, OPEN_DIR);
    await started(env(), { ...fakes().ports, platform: "linux" });
    expect(logText()).toContain("DATA_DIR is open to other users");
  });

  it.skipIf(isWindows)("leaves an existing DATA_DIR's mode alone", async () => {
    mkdirSync(dataDir, { mode: OPEN_DIR });
    chmodSync(dataDir, OPEN_DIR);
    await started(env(), fakes().ports);
    expect(statSync(dataDir).mode & PERMISSIONS).toBe(OPEN_DIR);
  });

  it.skipIf(isWindows)("does not warn about an existing owner-only DATA_DIR", async () => {
    mkdirSync(dataDir, { mode: OWNER_ONLY });
    await started(env(), fakes().ports);
    expect(logText()).not.toContain("DATA_DIR is open to other users");
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

  it("listens on 127.0.0.1 at PORT before the plugins start, answering health while they load", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    let whileLoading: unknown = null;
    let otherRoute = 0;
    const spawn: SpawnWorker = (data) => {
      const worker = fakeWorker(data);
      void (async () => {
        whileLoading = await (await fetch(healthUrl())).json();
        otherRoute = (await fetch(`http://127.0.0.1:${String(port)}/api/anything`)).status;
        worker.ready();
      })();
      return worker.handle;
    };
    const running = await started(env(), { ...fakes().ports, spawn });
    expect(running.address).toBe(`http://127.0.0.1:${String(port)}`);
    expect(whileLoading).toMatchObject({ ready: false, plugins: { loaded: 0, disabled: 0 } });
    expect(otherRoute).toBe(UNAVAILABLE);
    expect((await fetch(`http://127.0.0.1:${String(port)}/api/anything`)).status).toBe(NOT_FOUND);
    expect(await (await fetch(healthUrl())).json()).toMatchObject({ plugins: { loaded: 1, disabled: 0 } });
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
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.StartupFailed } });
    expect(logText()).toContain("startup failed");
  });
});

describe("App startup when the port is taken", () => {
  it("fails before it touches the database, starts a plugin or arms a scan", async () => {
    const release = await occupy(port);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const { ports, armed, spawned, fetchLatest } = fakes();
    const result = await startApp(env(), ports);
    await release();
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.StartupFailed } });
    expect(JSON.stringify(result)).toContain("EADDRINUSE");
    expect({ armed, spawned, fetched: fetchLatest.mock.calls.length }).toEqual({ armed: [], spawned: [], fetched: 0 });
    expect(existsSync(join(dataDir, DB_FILE))).toBe(false);
    expect(logText()).toContain("startup failed");
  });

  it("closes the server and the database when a later step throws, with a one-line message", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const spawn: SpawnWorker = () => {
      throw new Error("cannot spawn");
    };
    const result = await startApp(env(), { ...fakes().ports, spawn });
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.StartupFailed } });
    expect(result.ok ? "" : result.error.message).toBe("Error: cannot spawn");
    await (await occupy(port))();
  });
});

describe("App startup cancelled by a shutdown request", () => {
  it("stops after the step that was running, closes what it opened and arms no scan", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const controller = new AbortController();
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const spawn: SpawnWorker = (data) => {
      const worker = fakeWorker(data);
      workers.push(worker);
      controller.abort();
      queueMicrotask(() => {
        worker.ready();
      });
      return worker.handle;
    };
    const { ports, armed } = fakes();
    const result = await startApp(env(), { ...ports, spawn }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.Cancelled } });
    expect(armed).toEqual([]);
    expect(workers.map((worker) => worker.terminations())).toEqual([1]);
    expect(logText()).toContain("startup cancelled");
    await (await occupy(port))();
  });

  it("honours a request made while the database opens before any plugin worker starts", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "aborted", { get: () => existsSync(join(dataDir, DB_FILE)) });
    const { ports, spawned } = fakes();
    const result = await startApp(env(), ports, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.Cancelled, clean: true } });
    expect(spawned).toEqual([]);
    await (await occupy(port))();
  });

  it("reports a cancelled startup whose cleanup failed as not clean", async () => {
    const controller = new AbortController();
    controller.abort();
    const browser: ClosableBrowserDriver = {
      fetchPage: async () => Promise.reject(new Error("unused")),
      close: async () => Promise.reject(new Error("browser stuck")),
    };
    const result = await startApp(env(), { ...fakes().ports, browser }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { kind: StartupErrorKind.Cancelled, clean: false } });
  });
});

describe("App settings changes", () => {
  const startWithPlugin = async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const { workers, spawn } = readyWorkers();
    const fake = fakes();
    const running = await started(env(), { ...fake.ports, spawn });
    const put = async (change: Partial<Settings>) => {
      const current = await running.deps.repository.settings.get();
      const payload = { ...current, ...change };
      return running.server.inject({ method: "PUT", url: apiRoutes.putSettings.url, headers: host(), payload });
    };
    return { running, workers, armed: fake.armed, put };
  };

  it("restarts the plugin host with a new ship-to country and re-arms the schedule", async () => {
    const { running, workers, armed, put } = await startWithPlugin();
    const stores = running.deps.stores;
    expect((await put({ shipToCountry: "US" })).statusCode).toBe(OK);
    expect(workers.map((worker) => ({ shipTo: worker.data.shipTo, terminated: worker.terminations() > 0 }))).toEqual([
      { shipTo: "IL", terminated: true },
      { shipTo: "US", terminated: false },
    ]);
    expect(running.deps.stores).not.toBe(stores);
    expect(armed).toEqual([armed[0], armed[0]]);
    expect(running.plugins.plugins()[0]?.status.kind).toBe(PluginStatusKind.Loaded);
    await running.shutdown();
    expect(workers[1]?.terminations()).toBe(1);
  });

  it("restarts the plugin host with a new display currency", async () => {
    const { workers, put } = await startWithPlugin();
    await put({ displayCurrency: "EUR" });
    expect(workers.map((worker) => worker.data.currencyPreference)).toEqual(["ILS", "EUR"]);
  });

  it("re-arms the schedule with a new scan interval without restarting the plugins, and scans on it", async () => {
    const { running, workers, armed, put } = await startWithPlugin();
    await put({ scanIntervalHours: 1 });
    expect(workers).toHaveLength(1);
    expect(armed).toEqual([armed[0], MS_PER_HOUR]);
    const scan = await running.server.inject({ method: "POST", url: apiRoutes.startScan.url, headers: host() });
    expect(scan.statusCode).toBe(ACCEPTED);
  });

  const startRefusingUsOnce = async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const ready = readyWorkers();
    let refuseUs = true;
    const spawn: SpawnWorker = (data) => {
      if (data.shipTo === "US" && refuseUs) {
        refuseUs = false;
        throw new Error("cannot spawn");
      }
      return ready.spawn(data);
    };
    const running = await started(env(), { ...fakes().ports, spawn });
    const payload = { ...(await running.deps.repository.settings.get()), shipToCountry: "US" };
    const put = async () =>
      running.server.inject({ method: "PUT", url: apiRoutes.putSettings.url, headers: host(), payload });
    return { running, workers: ready.workers, put };
  };

  it("keeps the old settings and plugins when the host cannot restart, so retrying the same change works", async () => {
    const { running, workers, put } = await startRefusingUsOnce();
    expect((await put()).statusCode).toBe(INTERNAL_ERROR);
    expect(await running.deps.repository.settings.get()).toMatchObject({ shipToCountry: "IL" });
    expect(running.plugins.plugins()[0]?.status.kind).toBe(PluginStatusKind.Loaded);
    expect(workers.map((worker) => worker.terminations())).toEqual([0]);
    expect((await put()).statusCode).toBe(OK);
    expect(await running.deps.repository.settings.get()).toMatchObject({ shipToCountry: "US" });
    expect(workers.map((worker) => ({ shipTo: worker.data.shipTo, terminated: worker.terminations() > 0 })))
      .toEqual([{ shipTo: "IL", terminated: true }, { shipTo: "US", terminated: false }]);
  });

  it("logs a failed change once, as the request that failed", async () => {
    const { put } = await startRefusingUsOnce();
    await put();
    expect(logText().match(/cannot spawn/gu)).toEqual(["cannot spawn"]);
  });

  it("restarts nothing when only the drop threshold changes", async () => {
    const { running, workers, armed, put } = await startWithPlugin();
    await put({ priceDropMinBasisPoints: 100 });
    expect({ workers: workers.length, armed: armed.length }).toEqual({ workers: 1, armed: 1 });
    expect(await running.deps.repository.settings.get()).toMatchObject({ priceDropMinBasisPoints: 100 });
  });
});

describe("App shutdown", () => {
  it("stops the schedule, then the server, the plugin host, the browser, the database and the log, once", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const { workers, spawn } = readyWorkers();
    const seen: Record<string, unknown>[] = [];
    const holder: { app?: App } = {};
    const observe = async (step: string): Promise<void> => {
      const running = holder.app;
      const listening = running?.server.server.listening;
      const terminatedWorkers = workers.filter((worker) => worker.terminations() > 0).length;
      running?.logger.info(`observed ${step}`);
      const database = await running?.deps.repository.settings.get().then(() => "open", () => "closed");
      seen.push({ step, listening, terminatedWorkers, database });
    };
    const { ports } = fakes();
    const scheduler: Scheduler = { every: () => () => void observe("scheduler") };
    const browser: ClosableBrowserDriver = {
      fetchPage: async () => Promise.reject(new Error("unused")),
      close: async () => observe("browser"),
    };
    const running = await started(env(), { ...ports, scheduler, browser, spawn });
    holder.app = running;
    expect(await running.shutdown()).toBe(true);
    expect(await running.shutdown()).toBe(true);
    expect(seen).toEqual([
      { step: "scheduler", listening: true, terminatedWorkers: 0, database: "open" },
      { step: "browser", listening: false, terminatedWorkers: 1, database: "open" },
    ]);
    await expect(running.deps.repository.settings.get()).rejects.toThrow();
    expect(logText()).toContain("observed browser");
    running.logger.info("after the log closed");
    expect(logText()).not.toContain("after the log closed");
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

describe("DATA_DIR permission check", () => {
  it.each([
    [OPEN_DIR, "linux", true],
    [GROUP_READABLE, "darwin", true],
    [OWNER_ONLY, "linux", false],
    [PERMISSIONS, "win32", false],
  ] as const)("mode %o on %s is open to others: %s", (mode, platform, open) => {
    expect(isOpenToOthers(mode, platform)).toBe(open);
  });
});
