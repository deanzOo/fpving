import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, pluginIdSchema, startScheduler } from "@fpving/core";
import type { PluginId, SchedulerHandle, StoreGateway } from "@fpving/core";
import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, SearchCandidate, StoreResult } from "@fpving/plugin-sdk";
import { vi } from "vitest";
import { keylessLlmJudge } from "../../src/adapters/anthropic/llm-judge.ts";
import { migrate } from "../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../src/adapters/sqlite/repository.ts";
import { registerApiRoutes } from "../../src/server/api.ts";
import type { ApiRuntime } from "../../src/server/api.ts";
import type { PluginRow } from "../../src/server/api-routes.ts";
import { createServer } from "../../src/server/server.ts";
import { FX } from "./app-fixtures.ts";
import { recordingLogger } from "./recording-logger.ts";

const ID_DIGITS = 4;

/** The port every harness request's Host header names. */
export const API_PORT = 4321;

/** The Host header the harness sends. */
export const API_HOST = { host: `127.0.0.1:${String(API_PORT)}` };

/** The plugin that serves {@link SHOP_DOMAIN}. */
export const SHOP = pluginIdSchema.parse("shop");

/** The plugin that serves {@link OTHER_DOMAIN} and can search. */
export const OTHER = pluginIdSchema.parse("other");

/** A domain {@link SHOP} declares. */
export const SHOP_DOMAIN = "shop.example";

/** A domain {@link OTHER} declares. */
export const OTHER_DOMAIN = "other.example";

/** What the fake stores answer for a page that was not scripted. */
export const LISTING: FetchedListing = {
  title: "Acme Quad X5 frame",
  itemPrice: { amountMinor: 12_000, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: 500, currency: "USD" },
  inStock: true,
  images: [],
};

/**
 * A scripted gateway over {@link SHOP} and {@link OTHER}; answers are read at call time, so tests change them. Fetches
 * wait for `script.fetching`.
 */
export const fakeGateway = () => {
  const answers = new Map<string, StoreResult<FetchedListing>>();
  const script: { search: StoreResult<SearchCandidate[]>; fetching: Promise<void> } = {
    search: ok([]),
    fetching: Promise.resolve(),
  };
  const plugins: readonly [PluginId, string][] = [[SHOP, SHOP_DOMAIN], [OTHER, OTHER_DOMAIN]];
  const gateway: StoreGateway = {
    declaredDomains: () => plugins.map(([, domain]) => domain),
    pluginFor: (url) => plugins.find(([, domain]) => new URL(url).hostname === domain)?.[0] ?? null,
    fetchListing: async (_pluginId, url) => {
      await script.fetching;
      return answers.get(url) ?? ok(LISTING);
    },
    search: async () => Promise.resolve(script.search),
    searchablePlugins: () => [OTHER],
  };
  return { gateway, answers, script };
};

/** A network error the gateway answers for a plugin that is not loaded. */
export const networkError = (detail: string): StoreResult<never> =>
  ({ ok: false, error: { kind: StoreErrorKind.Network, detail } });

/**
 * The domain routes on a server that is ready, over a real SQLite in a temp folder, the scripted gateway, the keyless
 * judge, a fixed clock and counting ids, with core's real scheduler on a timer that never fires.
 */
export const startApiHarness = async () => {
  const dir = mkdtempSync(join(tmpdir(), "fpving-api-"));
  const dbPath = join(dir, "api.db");
  migrate(dbPath);
  const { repository, close } = openSqliteRepository(dbPath);
  const logger = recordingLogger();
  const stores = fakeGateway();
  let next = 0;
  let millis = Date.parse("2026-10-30T10:00:00.000Z");
  const deps = {
    repository,
    stores: stores.gateway,
    ids: { next: () => `id-${String((next += 1)).padStart(ID_DIGITS, "0")}` },
    clock: { now: () => new Date((millis += 1)) },
    notifier: { notify: vi.fn(async () => Promise.resolve(ok(undefined))) },
    logger,
    llm: keylessLlmJudge(logger),
    rates: { fetchLatest: async () => Promise.resolve(ok(FX)) },
    scheduler: { every: () => () => undefined },
  };
  const scans: { current: SchedulerHandle } = { current: await startScheduler(deps) };
  const rows: { current: readonly PluginRow[] } = { current: [] };
  const restarting = { current: false };
  const stopping = { current: false };
  const applySettings = vi.fn<ApiRuntime["applySettings"]>(async (settings) => {
    await repository.settings.save(settings);
    return ok(undefined);
  });
  const runtime: ApiRuntime = {
    deps: () => deps,
    scans: () => scans.current,
    plugins: () => rows.current,
    applySettings,
    restarting: () => restarting.current,
    stopping: () => stopping.current,
  };
  const server = createServer({ port: API_PORT, logger, isReady: () => true, openWhileStarting: [] });
  registerApiRoutes(server).attach(runtime);
  await server.ready();
  const request = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) =>
    server.inject({ method, url, headers: API_HOST, ...(payload === undefined ? {} : { payload }) });
  return {
    server,
    request,
    repository,
    stores,
    logger,
    scans,
    rows,
    restarting,
    stopping,
    applySettings,
    close: async () => {
      await scans.current.stop();
      await server.close();
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** What {@link startApiHarness} returns. */
export type ApiHarness = Awaited<ReturnType<typeof startApiHarness>>;
