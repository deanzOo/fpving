import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginIdSchema } from "@fpving/core";
import type { StoreGateway } from "@fpving/core";
import { vi } from "vitest";
import { createFileDebugSink } from "../../src/adapters/debug/file-debug-sink.ts";
import { createDomainLimiter } from "../../src/adapters/transport/domain-limiter.ts";
import { createFetchHttpClient } from "../../src/adapters/transport/fetch-http-client.ts";
import { createUserAgent, readAppVersion } from "../../src/adapters/transport/user-agent.ts";
import { PLUGINS_FILE, readPluginsConfig, readTextFile } from "../../src/plugins/config.ts";
import { startPluginHost } from "../../src/plugins/runtime/host.ts";
import type { PluginHost } from "../../src/plugins/runtime/host.ts";
import { createPluginStoreGateway } from "../../src/plugins/store-gateway.ts";
import { fakeServices } from "../plugins/runtime/fake-worker.ts";
import { startLocalServer } from "./local-server.ts";
import type { LocalServer } from "./local-server.ts";
import { fixturePlugin, spawnSourceWorker } from "./plugin-workers.ts";

/** The id of the test-only plugin in `test/fixture-plugin`. */
export const FIXTURE_SHOP = pluginIdSchema.parse("fixture-shop");

/** The id of the `capabilities` fixture plugin, which does not declare search. */
export const CAPABLE_SHOP = pluginIdSchema.parse("capable-shop");

/** When the fixture gateway's debug sink stamps its files. */
export const FIXTURE_NOW = new Date("2026-10-29T10:11:12.345Z");

const ORIGIN_ENV = "FPVING_FIXTURE_ORIGIN";
const LOAD_TIMEOUT_MS = 20_000;
const FIXTURE_PLUGIN_DIR = fileURLToPath(new URL("../fixture-plugin", import.meta.url));

/** A gateway over real plugin workers that read the local server, and what a test needs to look behind it. */
export interface FixtureGateway {
  readonly gateway: StoreGateway;
  readonly host: PluginHost;
  readonly server: LocalServer;
  readonly dataDir: string;
  readonly warn: ReturnType<typeof fakeServices>["mocks"]["warn"];
  close(): Promise<void>;
}

/**
 * Writes a `plugins.json` listing the fixture plugin and the `capabilities` fixture into a temp `DATA_DIR`, starts
 * the host on it with the real HTTP client against a fresh local server, and builds the gateway with a file debug sink.
 */
export const startFixtureGateway = async (): Promise<FixtureGateway> => {
  const server = await startLocalServer();
  const dataDir = await mkdtemp(join(tmpdir(), "fpving-gateway-"));
  const entries = [{ path: FIXTURE_PLUGIN_DIR }, fixturePlugin("capabilities")];
  await writeFile(join(dataDir, PLUGINS_FILE), JSON.stringify(entries));
  const config = await readPluginsConfig(dataDir, readTextFile);
  if (!config.ok) {
    throw new Error(`the fixture plugins.json was refused: ${config.error.detail}`);
  }
  const { services, mocks } = fakeServices();
  const limiter = createDomainLimiter({ now: () => Date.now(), sleep: async () => Promise.resolve(), random: () => 0 });
  const userAgent = createUserAgent(readAppVersion());
  const http = createFetchHttpClient({ fetch, limiter, userAgent, allowPrivateHosts: true });
  vi.stubEnv(ORIGIN_ENV, server.origin);
  const host = await startPluginHost({
    entries: config.value.entries,
    services: { ...services, http },
    shipTo: "IL",
    currencyPreference: "USD",
    spawn: spawnSourceWorker,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
  });
  const debugSink = createFileDebugSink({ dataDir, clock: { now: () => FIXTURE_NOW } });
  const gateway = createPluginStoreGateway({ host, debugSink, logger: services.logger });
  return {
    gateway,
    host,
    server,
    dataDir,
    warn: mocks.warn,
    close: async () => {
      await host.shutdown();
      vi.unstubAllEnvs();
      await server.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
};
