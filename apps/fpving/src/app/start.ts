import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import { err, ok, startScheduler } from "@fpving/core";
import type {
  Clock,
  CurrencyRates,
  HttpClient,
  IdGenerator,
  LlmJudge,
  Notifier,
  Result,
  Scheduler,
  SchedulerHandle,
  Settings,
} from "@fpving/core";
import { anthropicMessages, createAnthropicLlmJudge, keylessLlmJudge } from "../adapters/anthropic/llm-judge.js";
import { createFileDebugSink } from "../adapters/debug/file-debug-sink.js";
import { createHttpFxRates } from "../adapters/fx/http-fx-rates.js";
import { createPinoLogger } from "../adapters/logger/pino-logger.js";
import type { ClosableLogger } from "../adapters/logger/pino-logger.js";
import { createOsNotifier, notifyBackendFor } from "../adapters/notifier/os-notifier.js";
import { migrate } from "../adapters/sqlite/migrate.js";
import { openSqliteRepository } from "../adapters/sqlite/repository.js";
import { createTimerScheduler, systemClock, uuidIdGenerator } from "../adapters/system/system-ports.js";
import { createDomainLimiter, systemTiming } from "../adapters/transport/domain-limiter.js";
import { createFetchHttpClient } from "../adapters/transport/fetch-http-client.js";
import { launchChromium } from "../adapters/transport/launch-chromium.js";
import { createPlaywrightBrowserDriver } from "../adapters/transport/playwright-browser-driver.js";
import type { ClosableBrowserDriver } from "../adapters/transport/playwright-browser-driver.js";
import { createUserAgent, readAppVersion } from "../adapters/transport/user-agent.js";
import { parseEnv } from "../config/env.js";
import type { Env } from "../config/env.js";
import { readPluginsConfig, readTextFile } from "../plugins/config.js";
import type { SpawnWorker } from "../plugins/runtime/connection.js";
import { spawnWorker, startPluginHost, WORKER_ENTRY } from "../plugins/runtime/host.js";
import type { PluginHost, PluginState } from "../plugins/runtime/host.js";
import { createPluginStoreGateway } from "../plugins/store-gateway.js";
import { registerApiRoutes } from "../server/api.js";
import { HEALTH_PATH, registerHealthRoute } from "../server/health.js";
import { pluginRows } from "../server/plugin-rows.js";
import { createServer, LOOPBACK_HOST } from "../server/server.js";
import type { AppServer } from "../server/server.js";
import { sequenceShutdown, SHUTDOWN_DEADLINE_MS, withinDeadline } from "./lifecycle.js";
import type { ShutdownStep } from "./lifecycle.js";
import { createSettingsApplier } from "./settings.js";
import type { AppDeps, LiveParts } from "./settings.js";

/** The database file in `DATA_DIR`. */
export const DB_FILE = "fpving.db";

/** The log file, relative to `DATA_DIR`. */
export const LOG_FILE = join("logs", "fpving.log");

const BROWSER_PROFILE_DIR = "browser-profile";

const OWNER_ONLY_DIR = 0o700;
const GROUP_OR_WORLD = 0o077;

/** Why the app did not start. `cancelled`: a shutdown was requested while it was starting. */
export const StartupErrorKind = {
  InvalidEnv: "invalid_env",
  DataDirFailed: "data_dir_failed",
  StartupFailed: "startup_failed",
  Cancelled: "cancelled",
} as const;

type FailureKind = Exclude<(typeof StartupErrorKind)[keyof typeof StartupErrorKind], typeof StartupErrorKind.Cancelled>;

/**
 * A startup failure; `message` is one line for the terminal and never contains the API key. A cancelled startup
 * says whether closing what it had opened succeeded within the shutdown deadline.
 */
export type StartupError
  = | { readonly kind: FailureKind; readonly message: string }
    | { readonly kind: typeof StartupErrorKind.Cancelled; readonly message: string; readonly clean: boolean };

/**
 * The ports the app wires from real adapters by default, and the OS it checks file modes for. Tests pass any of
 * them as overrides; every factory in the app shell takes its replaceable parts this way.
 */
export interface AppPorts {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly scheduler: Scheduler;
  readonly rates: CurrencyRates;
  readonly notifier: Notifier;
  readonly http: HttpClient;
  readonly browser: ClosableBrowserDriver;
  readonly llm: LlmJudge;
  readonly spawn: SpawnWorker;
  readonly platform: NodeJS.Platform;
}

/** The running app. */
export interface App {
  readonly env: Env;
  readonly server: AppServer;
  /** Every port core's use cases take, as they are now; a settings change can replace the store gateway. */
  readonly deps: AppDeps;
  readonly scans: SchedulerHandle;
  /** The plugin host now; a settings change can replace it. */
  readonly plugins: PluginHost;
  readonly logger: ClosableLogger;
  /** Where the server listens, `http://127.0.0.1:PORT`. */
  readonly address: string;
  /**
   * Stops the scan schedule, closes the server, shuts the plugin host down, closes the browser, the database and the
   * log, in that order. Idempotent; resolves false when a step failed.
   */
  readonly shutdown: () => Promise<boolean>;
}

const ShutdownStepName = {
  Scans: "scan schedule",
  Server: "server",
  Plugins: "plugin host",
  Browser: "browser",
  Database: "database",
  Log: "log",
} as const;

const SHUTDOWN_ORDER: readonly string[] = Object.values(ShutdownStepName);
const CANCELLED = "startup was cancelled by a shutdown request";

const failed = (kind: FailureKind, message: string): Result<never, StartupError> => err({ kind, message });

/**
 * Whether a folder mode lets users other than the owner in. Windows has no such bits, so it is never reported there.
 *
 * @param mode - The `stat` mode.
 * @param platform - The OS.
 * @returns True when group or others have any permission on POSIX.
 */
export const isOpenToOthers = (mode: number, platform: NodeJS.Platform): boolean =>
  platform !== "win32" && (mode & GROUP_OR_WORLD) !== 0;

const prepareDataDir = async (
  env: Env,
  platform: NodeJS.Platform,
): Promise<Result<{ readonly logger: ClosableLogger; readonly openToOthers: boolean }, StartupError>> => {
  const dataDir = env.DATA_DIR;
  try {
    const created = await mkdir(dataDir, { recursive: true, mode: OWNER_ONLY_DIR });
    if (created !== undefined) {
      await chmod(dataDir, OWNER_ONLY_DIR);
    }
    const openToOthers = created === undefined && isOpenToOthers((await stat(dataDir)).mode, platform);
    return ok({ logger: createPinoLogger({ level: env.LOG_LEVEL, file: join(dataDir, LOG_FILE) }), openToOthers });
  } catch (error) {
    return failed(StartupErrorKind.DataDirFailed, `Cannot prepare DATA_DIR: ${String(error)}`);
  }
};

const readPlugins = async (dataDir: string, logger: ClosableLogger) => {
  const config = await readPluginsConfig(dataDir, readTextFile);
  if (!config.ok) {
    logger.error("plugins.json is unusable, no plugins load", { kind: config.error.kind, detail: config.error.detail });
    return { entries: [], rejected: [], issue: config.error };
  }
  for (const { index, issue } of config.value.rejected) {
    logger.warn("plugins.json entry rejected", { index, kind: issue.kind, detail: issue.detail });
  }
  return { ...config.value, issue: null };
};

const judgeFor = (env: Env, logger: ClosableLogger): LlmJudge => {
  if (env.ANTHROPIC_API_KEY === undefined) {
    logger.info("no ANTHROPIC_API_KEY set; match candidates stay unjudged");
    return keylessLlmJudge(logger);
  }
  return createAnthropicLlmJudge(anthropicMessages({ apiKey: env.ANTHROPIC_API_KEY }), logger);
};

/**
 * Starts the app: parses the environment, creates `DATA_DIR` owner-only (an existing one keeps its mode, with a
 * warning when others can open it) and opens the log; a failure there is `data_dir_failed`. Then it binds the server
 * to `127.0.0.1:PORT`, which is the single-instance lock: a second instance fails there, before it touches the
 * database, loads a plugin or scans.
 * While starting, only the health route answers; every other route answers 503. Then it migrates and opens the
 * database, starts the plugin host with the saved ship-to country and display currency, wires every adapter into
 * core and starts the scan schedule. Any failure after the log opened, and a shutdown requested through `signal`
 * while starting, closes what was opened, within the shutdown deadline. The plugin host keeps the settings it started
 * with, so a settings change needs a restart.
 *
 * @param source - The `process.env`-shaped environment.
 * @param overrides - Ports to use instead of the real adapters, see {@link AppPorts}.
 * @param signal - Aborted to cancel the startup; it is checked after each slow step.
 * @returns The listening app, or why it did not start.
 */
export const startApp = async (
  source: Readonly<Record<string, string | undefined>>,
  overrides: Partial<AppPorts> = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<Result<App, StartupError>> => {
  const parsed = parseEnv(source);
  if (!parsed.ok) {
    return failed(StartupErrorKind.InvalidEnv, parsed.error.message);
  }
  const env = parsed.value;
  const dataDir = env.DATA_DIR;
  const platform = overrides.platform ?? process.platform;
  const prepared = await prepareDataDir(env, platform);
  if (!prepared.ok) {
    return prepared;
  }
  const { logger } = prepared.value;
  if (prepared.value.openToOthers) {
    logger.warn("DATA_DIR is open to other users; consider chmod 700", { dataDir });
  }
  const closeLog = (): void => {
    logger.close();
  };
  const steps: ShutdownStep[] = [{ name: ShutdownStepName.Log, run: closeLog }];
  const opened = (step: ShutdownStep): void => {
    steps.push(step);
    steps.sort((a, b) => SHUTDOWN_ORDER.indexOf(a.name) - SHUTDOWN_ORDER.indexOf(b.name));
  };
  const shutdown = sequenceShutdown(steps, logger);
  const checkpoint = (): void => {
    if (signal.aborted) {
      throw new Error(CANCELLED);
    }
  };
  let ready = false;
  let pluginStates = (): readonly PluginState[] => [];
  let rejectedEntries = 0;
  let plugins: Awaited<ReturnType<typeof readPlugins>> = { entries: [], rejected: [], issue: null };
  try {
    const version = readAppVersion();
    const limiter = createDomainLimiter(systemTiming);
    const http = overrides.http ?? createFetchHttpClient({
      fetch: globalThis.fetch,
      limiter,
      userAgent: createUserAgent(version),
    });
    const browser = overrides.browser ?? createPlaywrightBrowserDriver({
      launch: launchChromium,
      limiter,
      profileDir: join(dataDir, BROWSER_PROFILE_DIR),
    });
    opened({ name: ShutdownStepName.Browser, run: async () => browser.close() });
    const server = createServer({ port: env.PORT, logger, isReady: () => ready, openWhileStarting: [HEALTH_PATH] });
    registerHealthRoute(server, {
      version,
      ready: () => ready,
      plugins: () => pluginStates(),
      rejectedEntries: () => rejectedEntries,
    });
    const api = registerApiRoutes(server);
    opened({ name: ShutdownStepName.Server, run: async () => server.close() });
    const address = await server.listen({ host: LOOPBACK_HOST, port: env.PORT });
    checkpoint();
    const dbPath = join(dataDir, DB_FILE);
    migrate(dbPath);
    const { repository, close: closeDatabase } = openSqliteRepository(dbPath);
    opened({ name: ShutdownStepName.Database, run: closeDatabase });
    const settings = await repository.settings.get();
    plugins = await readPlugins(dataDir, logger);
    rejectedEntries = plugins.rejected.length + (plugins.issue === null ? 0 : 1);
    checkpoint();
    const spawn = overrides.spawn ?? spawnWorker(WORKER_ENTRY);
    const startHost = async ({ shipToCountry, displayCurrency }: Settings) => startPluginHost({
      entries: plugins.entries,
      services: { http, browser, logger },
      shipTo: shipToCountry,
      currencyPreference: displayCurrency,
      spawn,
    });
    const host = await startHost(settings);
    let currentHost = (): PluginHost => host;
    opened({ name: ShutdownStepName.Plugins, run: async () => currentHost().shutdown() });
    pluginStates = () => currentHost().plugins();
    checkpoint();
    const clock = overrides.clock ?? systemClock;
    const debugSink = createFileDebugSink({ dataDir, clock });
    const gatewayFor = (current: PluginHost) => createPluginStoreGateway({ host: current, debugSink, logger });
    const deps = {
      repository,
      stores: gatewayFor(host),
      ids: overrides.ids ?? uuidIdGenerator,
      clock,
      notifier: overrides.notifier ?? createOsNotifier(notifyBackendFor(platform)),
      logger,
      llm: overrides.llm ?? judgeFor(env, logger),
      rates: overrides.rates ?? createHttpFxRates(globalThis.fetch),
      scheduler: overrides.scheduler ?? createTimerScheduler(),
    };
    const parts: LiveParts = { host, deps, scans: await startScheduler(deps) };
    const settingsApplier = createSettingsApplier({ live: parts, applied: settings, startHost, gatewayFor });
    let stopping = false;
    opened({
      name: ShutdownStepName.Scans,
      run: async () => {
        stopping = true;
        await settingsApplier.close();
        await parts.scans.stop();
      },
    });
    currentHost = () => parts.host;
    api.attach({
      deps: () => parts.deps,
      scans: () => parts.scans,
      plugins: () => pluginRows(parts.host.plugins(), plugins.rejected, plugins.issue),
      applySettings: async (next) => settingsApplier.apply(next),
      restarting: () => settingsApplier.restarting(),
      stopping: () => stopping,
    });
    ready = true;
    logger.info("fpving started", { version, address, plugins: plugins.entries.length });
    return ok({
      env,
      server,
      get deps() {
        return parts.deps;
      },
      get scans() {
        return parts.scans;
      },
      get plugins() {
        return parts.host;
      },
      logger,
      address,
      shutdown,
    });
  } catch (error) {
    const cancelled = signal.aborted;
    logger.error(cancelled ? "startup cancelled" : "startup failed", { detail: inspect(error) });
    const clean = await withinDeadline(shutdown(), SHUTDOWN_DEADLINE_MS, logger);
    return cancelled
      ? err({ kind: StartupErrorKind.Cancelled, message: CANCELLED, clean })
      : failed(StartupErrorKind.StartupFailed, String(error));
  }
};
