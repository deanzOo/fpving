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
  MatchDeps,
  Notifier,
  Result,
  Scheduler,
  SchedulerDeps,
  SchedulerHandle,
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
import { registerHealthRoute } from "../server/health.js";
import { createServer, LOOPBACK_HOST } from "../server/server.js";
import type { AppServer } from "../server/server.js";
import { sequenceShutdown, SHUTDOWN_DEADLINE_MS, withinDeadline } from "./lifecycle.js";

/** The database file in `DATA_DIR`. */
export const DB_FILE = "fpving.db";

/** The log file, relative to `DATA_DIR`. */
export const LOG_FILE = join("logs", "fpving.log");

const BROWSER_PROFILE_DIR = "browser-profile";

const OWNER_ONLY_DIR = 0o700;
const GROUP_OR_WORLD = 0o077;

/** Why the app did not start. */
export const StartupErrorKind = {
  InvalidEnv: "invalid_env",
  DataDirFailed: "data_dir_failed",
  MigrateFailed: "migrate_failed",
  StartupFailed: "startup_failed",
} as const;

/** A startup failure; `message` is for the terminal and never contains the API key. */
export interface StartupError {
  readonly kind: (typeof StartupErrorKind)[keyof typeof StartupErrorKind];
  readonly message: string;
}

/**
 * The ports the app wires from real adapters by default. Tests pass any of them as overrides; every factory in the
 * app shell takes its replaceable ports this way.
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
}

/** The running app. */
export interface App {
  readonly env: Env;
  readonly server: AppServer;
  /** Every port core's use cases take. */
  readonly deps: MatchDeps & SchedulerDeps;
  readonly scans: SchedulerHandle;
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

const failed = (kind: StartupError["kind"], message: string): Result<never, StartupError> => err({ kind, message });

/**
 * Whether a folder mode lets users other than the owner in. Windows has no such bits, so it is never reported there.
 *
 * @param mode - The `stat` mode.
 * @param platform - The OS.
 * @returns True when group or others have any permission on POSIX.
 */
export const isOpenToOthers = (mode: number, platform: NodeJS.Platform): boolean =>
  platform !== "win32" && (mode & GROUP_OR_WORLD) !== 0;

const prepareDataDir = async (dataDir: string): Promise<Result<{ readonly openToOthers: boolean }, StartupError>> => {
  try {
    const created = await mkdir(dataDir, { recursive: true, mode: OWNER_ONLY_DIR });
    if (created !== undefined) {
      await chmod(dataDir, OWNER_ONLY_DIR);
      return ok({ openToOthers: false });
    }
    return ok({ openToOthers: isOpenToOthers((await stat(dataDir)).mode, process.platform) });
  } catch (error) {
    return failed(StartupErrorKind.DataDirFailed, `Cannot prepare DATA_DIR: ${String(error)}`);
  }
};

const migrateDatabase = (path: string, logger: ClosableLogger): Result<void, StartupError> => {
  try {
    migrate(path);
    return ok(undefined);
  } catch (error) {
    logger.error("database migration failed", { detail: inspect(error) });
    logger.close();
    return failed(StartupErrorKind.MigrateFailed, String(error));
  }
};

const readPlugins = async (dataDir: string, logger: ClosableLogger) => {
  const config = await readPluginsConfig(dataDir, readTextFile);
  if (!config.ok) {
    logger.error("plugins.json is unusable, no plugins load", { kind: config.error.kind, detail: config.error.detail });
    return { entries: [], rejected: [] };
  }
  for (const { index, issue } of config.value.rejected) {
    logger.warn("plugins.json entry rejected", { index, kind: issue.kind, detail: issue.detail });
  }
  return config.value;
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
 * warning when others can open it), opens the log, migrates the database before opening it, and binds the server to
 * `127.0.0.1:PORT`. Only once the port is bound does it start the plugin host with the saved ship-to country and
 * display currency, wire every adapter into core and start the scan schedule, so a second instance on a taken port
 * never loads plugins or scans. Any failure after the database opened closes what was opened, within the shutdown
 * deadline, and returns `startup_failed`. The plugin host keeps the settings it started with, so a settings change
 * needs a restart.
 *
 * @param source - The `process.env`-shaped environment.
 * @param overrides - Ports to use instead of the real adapters, see {@link AppPorts}.
 * @returns The listening app, or why it did not start.
 */
export const startApp = async (
  source: Readonly<Record<string, string | undefined>>,
  overrides: Partial<AppPorts> = {},
): Promise<Result<App, StartupError>> => {
  const parsed = parseEnv(source);
  if (!parsed.ok) {
    return failed(StartupErrorKind.InvalidEnv, parsed.error.message);
  }
  const env = parsed.value;
  const dataDir = env.DATA_DIR;
  const prepared = await prepareDataDir(dataDir);
  if (!prepared.ok) {
    return prepared;
  }
  const logger = createPinoLogger({ level: env.LOG_LEVEL, file: join(dataDir, LOG_FILE) });
  if (prepared.value.openToOthers) {
    logger.warn("DATA_DIR is open to other users; consider chmod 700", { dataDir });
  }
  const dbPath = join(dataDir, DB_FILE);
  const migrated = migrateDatabase(dbPath, logger);
  if (!migrated.ok) {
    return migrated;
  }
  const { repository, close: closeDatabase } = openSqliteRepository(dbPath);
  const version = readAppVersion();
  const limiter = createDomainLimiter(systemTiming);
  const userAgent = createUserAgent(version);
  const http = overrides.http ?? createFetchHttpClient({ fetch: globalThis.fetch, limiter, userAgent });
  const browser = overrides.browser ?? createPlaywrightBrowserDriver({
    launch: launchChromium,
    limiter,
    profileDir: join(dataDir, BROWSER_PROFILE_DIR),
  });
  const server = createServer({ port: env.PORT, logger });
  let plugins: PluginHost | null = null;
  let scans: SchedulerHandle | null = null;
  let pluginStates = (): readonly PluginState[] => [];
  const shutdown = sequenceShutdown(
    [
      { name: "scan schedule", run: async () => scans?.stop() },
      { name: "server", run: async () => server.close() },
      { name: "plugin host", run: async () => plugins?.shutdown() },
      { name: "browser", run: async () => browser.close() },
      { name: "database", run: closeDatabase },
      { name: "log", run: () => { logger.close(); } },
    ],
    logger,
  );
  try {
    const settings = await repository.settings.get();
    const { entries, rejected } = await readPlugins(dataDir, logger);
    registerHealthRoute(server, { version, plugins: () => pluginStates(), rejectedEntries: rejected.length });
    const address = await server.listen({ host: LOOPBACK_HOST, port: env.PORT });
    const host = await startPluginHost({
      entries,
      services: { http, browser, logger },
      shipTo: settings.shipToCountry,
      currencyPreference: settings.displayCurrency,
      spawn: overrides.spawn ?? spawnWorker(WORKER_ENTRY),
    });
    plugins = host;
    pluginStates = () => host.plugins();
    const clock = overrides.clock ?? systemClock;
    const deps = {
      repository,
      stores: createPluginStoreGateway({ host, debugSink: createFileDebugSink({ dataDir, clock }), logger }),
      ids: overrides.ids ?? uuidIdGenerator,
      clock,
      notifier: overrides.notifier ?? createOsNotifier(notifyBackendFor(process.platform)),
      logger,
      llm: overrides.llm ?? judgeFor(env, logger),
      rates: overrides.rates ?? createHttpFxRates(globalThis.fetch),
      scheduler: overrides.scheduler ?? createTimerScheduler(),
    };
    const running = await startScheduler(deps);
    scans = running;
    logger.info("fpving started", { version, address, plugins: entries.length });
    return ok({ env, server, deps, scans: running, plugins: host, logger, address, shutdown });
  } catch (error) {
    logger.error("startup failed", { detail: inspect(error) });
    await withinDeadline(shutdown(), SHUTDOWN_DEADLINE_MS, logger);
    return failed(StartupErrorKind.StartupFailed, String(error));
  }
};
