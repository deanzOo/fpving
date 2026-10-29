import { Worker } from "node:worker_threads";
import { pluginIdSchema } from "@fpving/core";
import type { PluginId } from "@fpving/core";
import {
  err,
  fetchedListingSchema,
  SDK_VERSION,
  searchCandidateSchema,
  StoreErrorKind,
} from "@fpving/plugin-sdk";
import type {
  CountryCode,
  CurrencyCode,
  FetchedListing,
  PluginManifest,
  SearchCandidate,
  SearchQuery,
  StoreError,
  StoreResult,
} from "@fpving/plugin-sdk";
import type { z } from "zod";
import { checkSdkCompatibility } from "../compatibility.js";
import type { PluginEntry } from "../config.js";
import { buildDomainRegistry } from "../registry.js";
import type { DomainRegistry } from "../registry.js";
import { PluginIssueKind, PluginStatusKind } from "../status.js";
import type { PluginIssue, PluginStatus } from "../status.js";
import { connect } from "./connection.js";
import type { Connection, HostServices, SpawnWorker } from "./connection.js";
import { CallMethod, storeResultSchema } from "./protocol.js";
import type { CallRequest } from "./protocol.js";

// Room for per-host limiter waits plus several 15 s HTTP or 30 s browser steps in one call.
const CALL_TIMEOUT_MS = 120_000;

const LOAD_TIMEOUT_MS = 30_000;

const MAX_WORKER_FAILURES = 2;
const SHUT_DOWN = "the plugin host is shut down";
const INVALID_OUTPUT = "invalid plugin output";

/** The built worker entry, next to this module in `dist`. */
export const WORKER_ENTRY = new URL("./worker-entry.js", import.meta.url);

/**
 * Spawns plugin workers from a worker entry file.
 *
 * @param entry - The worker entry module.
 * @param execArgv - Node options for the worker, such as a source condition in tests.
 * @returns The spawner.
 */
export const spawnWorker = (entry: URL, execArgv: readonly string[] = []): SpawnWorker => (data) =>
  new Worker(entry, { workerData: data, execArgv: [...execArgv] });

/** What the host needs to start the plugins. */
export interface PluginHostOptions {
  readonly entries: readonly PluginEntry[];
  readonly services: HostServices;
  readonly shipTo: CountryCode;
  readonly currencyPreference: CurrencyCode;
  readonly spawn?: SpawnWorker;
  readonly callTimeoutMs?: number;
  readonly loadTimeoutMs?: number;
}

/** One `plugins.json` entry as the host sees it: its manifest once loaded, and its status. */
export interface PluginState {
  readonly entry: PluginEntry;
  readonly manifest: PluginManifest | null;
  readonly status: PluginStatus;
}

/** The running plugins. Calls resolve to a `StoreResult` and never reject. */
export interface PluginHost {
  readonly registry: DomainRegistry;
  plugins(): readonly PluginState[];
  /** Calls the listener with every plugin's state after any status changes; returns an unsubscribe. */
  subscribe(listener: (plugins: readonly PluginState[]) => void): () => void;
  fetchListing(pluginId: PluginId, url: string): Promise<StoreResult<FetchedListing>>;
  search(pluginId: PluginId, query: SearchQuery): Promise<StoreResult<SearchCandidate[]>>;
  /** Terminates every worker and fails every open call. Idempotent. */
  shutdown(): Promise<void>;
}

interface Slot {
  readonly entry: PluginEntry;
  manifest: PluginManifest | null;
  status: PluginStatus;
  connection: Connection;
  current: Promise<Connection | null>;
  failures: number;
}

const network = (detail: string): StoreResult<never> => err({ kind: StoreErrorKind.Network, detail });

const parseOutput = <T extends z.ZodType>(schema: T, raw: StoreResult<unknown>) => {
  if (!raw.ok) {
    return raw;
  }
  const parsed = storeResultSchema(schema).safeParse(raw.value);
  return parsed.success ? parsed.data : err<StoreError>({ kind: StoreErrorKind.ParseFailed, detail: INVALID_OUTPUT });
};

/**
 * Starts one worker per entry, waits for each to report, then disables every plugin that failed to load, is
 * incompatible with the running SDK or loses all its domains, and stops their workers. A loaded worker that misses a
 * call deadline, errors or exits is restarted once; a second failure disables the plugin for the session.
 *
 * @param options - The entries, the real services, the context settings and, for tests, the spawner and deadlines.
 * @returns The host, once every worker has reported.
 */
export const startPluginHost = async (options: PluginHostOptions): Promise<PluginHost> => {
  const spawn = options.spawn ?? spawnWorker(WORKER_ENTRY);
  const listeners = new Set<(plugins: readonly PluginState[]) => void>();
  let closed = false;
  const isClosed = (): boolean => closed;

  const plugins = (): readonly PluginState[] =>
    slots.map(({ entry, manifest, status }) => ({ entry, manifest, status }));

  const disable = (slot: Slot, reason: PluginIssue): void => {
    slot.status = { kind: PluginStatusKind.Disabled, reason };
    void slot.connection.stop();
  };

  const crash = (slot: Slot, detail: string): void => {
    disable(slot, { kind: PluginIssueKind.Crashed, detail: `the plugin worker failed twice this session: ${detail}` });
    const snapshot = plugins();
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  };

  const open = (entry: PluginEntry, onFailure: (detail: string) => void): Connection => connect({
    spawn,
    data: { entry, shipTo: options.shipTo, currencyPreference: options.currencyPreference },
    services: options.services,
    callTimeoutMs: options.callTimeoutMs ?? CALL_TIMEOUT_MS,
    loadTimeoutMs: options.loadTimeoutMs ?? LOAD_TIMEOUT_MS,
    onFailure,
  });

  const restart = (slot: Slot, detail: string): void => {
    slot.failures += 1;
    if (slot.failures >= MAX_WORKER_FAILURES) {
      crash(slot, detail);
      return;
    }
    options.services.logger.warn("restarting a plugin worker", { pluginId: slot.manifest?.id ?? null, detail });
    const next = open(slot.entry, (later) => {
      restart(slot, later);
    });
    slot.connection = next;
    slot.current = next.loaded.then((outcome) => {
      if (outcome.ok) {
        return next;
      }
      if (!closed) {
        crash(slot, outcome.error.detail);
      }
      return null;
    });
  };

  const slots = options.entries.map((entry): Slot => {
    const slot: Slot = {
      entry,
      manifest: null,
      status: { kind: PluginStatusKind.Loaded, warnings: [] },
      connection: open(entry, (detail) => {
        restart(slot, detail);
      }),
      current: Promise.resolve(null),
      failures: 0,
    };
    slot.current = Promise.resolve(slot.connection);
    return slot;
  });

  const compatible: (Slot & { readonly id: PluginId; readonly domains: PluginManifest["domains"] })[] = [];
  for (const slot of slots) {
    const loaded = await slot.connection.loaded;
    const compatibility = loaded.ok ? checkSdkCompatibility(loaded.value, SDK_VERSION) : loaded;
    if (loaded.ok) {
      slot.manifest = loaded.value;
    }
    if (!compatibility.ok) {
      disable(slot, compatibility.error);
    } else if (loaded.ok) {
      const { id, domains } = loaded.value;
      compatible.push(Object.assign(slot, { id: pluginIdSchema.parse(id), domains }));
    }
  }
  const { registry, statuses } = buildDomainRegistry(compatible);
  const routes = new Map<PluginId, Slot>();
  for (const { plugin, status } of statuses) {
    plugin.status = status;
    if (status.kind === PluginStatusKind.Disabled) {
      disable(plugin, status.reason);
    } else {
      routes.set(plugin.id, plugin);
    }
  }

  const call = async (pluginId: PluginId, request: CallRequest): Promise<StoreResult<unknown>> => {
    const slot = routes.get(pluginId);
    if (slot?.status.kind !== PluginStatusKind.Loaded) {
      return network(`the plugin ${pluginId} is not loaded`);
    }
    const connection = await slot.current;
    if (isClosed()) {
      return network(SHUT_DOWN);
    }
    return connection === null ? network(`the plugin ${pluginId} is not loaded`) : connection.call(request);
  };

  return {
    registry,
    plugins,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    fetchListing: async (pluginId, url) =>
      parseOutput(fetchedListingSchema, await call(pluginId, { method: CallMethod.FetchListing, url })),
    search: async (pluginId, query) =>
      parseOutput(searchCandidateSchema.array(), await call(pluginId, { method: CallMethod.Search, query })),
    shutdown: async () => {
      closed = true;
      await Promise.all(slots.map(({ connection }) => connection.stop()));
    },
  };
};
