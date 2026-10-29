import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { err, manifestSchema, ok, PluginCapability, StoreErrorKind } from "@fpving/plugin-sdk";
import type { LogFields, PluginContext, PluginManifest, Result } from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind } from "../status.js";
import { createPending } from "./pending.js";
import { CallMethod, Capability, LogMethod, MessageType, parseHostMessage, parseWorkerData } from "./protocol.js";
import type {
  CallRequest,
  CapabilityCall,
  CapabilityResult,
  LoadFailure,
  WorkerData,
  WorkerMessage,
} from "./protocol.js";

/** The side of a `MessagePort` the worker uses; `parentPort` in a real worker. */
export interface WorkerPort {
  postMessage(message: WorkerMessage): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

/** Resolves and imports a plugin entry and resolves to its module namespace. */
export type ImportModule = (entry: WorkerData["entry"]) => Promise<unknown>;

interface LoadedStore {
  readonly manifest: PluginManifest;
  readonly store: Readonly<Record<string, unknown>>;
}

const PACKAGE_JSON = "package.json";
const MISMATCH = err({ kind: StoreErrorKind.Network, detail: "the host answered another capability" });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  (typeof value === "object" || typeof value === "function") && value !== null;

const importFromAppDir: ImportModule = (entry) =>
  import("path" in entry
    ? pathToFileURL(createRequire(join(entry.path, PACKAGE_JSON)).resolve(entry.path)).href
    : entry.package);

const issue = (kind: LoadFailure["kind"], detail: string): Result<never, LoadFailure> => err({ kind, detail });

const loadStore = async (
  data: WorkerData,
  ctx: PluginContext,
  load: ImportModule,
): Promise<Result<LoadedStore, LoadFailure>> => {
  let namespace: unknown;
  try {
    namespace = await load(data.entry);
  } catch (error) {
    return issue(PluginIssueKind.LoadFailed, `cannot import the plugin: ${String(error)}`);
  }
  const plugin = isRecord(namespace) && isRecord(namespace["default"]) ? namespace["default"] : namespace;
  if (!isRecord(plugin) || typeof plugin["createStore"] !== "function") {
    return issue(PluginIssueKind.ManifestInvalid, "the module must export manifest and createStore");
  }
  const manifest = manifestSchema.safeParse(plugin["manifest"]);
  if (!manifest.success) {
    return issue(PluginIssueKind.ManifestInvalid, `manifest: ${z.prettifyError(manifest.error)}`);
  }
  let store: unknown;
  try {
    store = Reflect.apply(plugin["createStore"], plugin, [ctx]);
  } catch (error) {
    return issue(PluginIssueKind.LoadFailed, `createStore threw: ${String(error)}`);
  }
  if (!isRecord(store) || typeof store["fetchListing"] !== "function") {
    return issue(PluginIssueKind.ManifestInvalid, "createStore must return a store with a fetchListing method");
  }
  if (manifest.data.capabilities.includes(PluginCapability.Search) && typeof store["search"] !== "function") {
    const detail = "createStore must return a store with search, which the manifest declares";
    return issue(PluginIssueKind.ManifestInvalid, detail);
  }
  return ok({ manifest: manifest.data, store });
};

const createContext = (port: WorkerPort, data: WorkerData) => {
  const capabilities = createPending<CapabilityResult>();
  const request = (call: CapabilityCall): Promise<CapabilityResult> => {
    const { id, result } = capabilities.open();
    port.postMessage({ type: MessageType.CapabilityCall, id, call });
    return result;
  };
  const log = (level: (typeof LogMethod)[keyof typeof LogMethod]) => (message: string, fields?: LogFields): void => {
    port.postMessage({ type: MessageType.Log, level, message, ...(fields === undefined ? {} : { fields }) });
  };
  const ctx: PluginContext = {
    http: {
      get: async (url, options) => {
        const call = { capability: Capability.HttpGet, url, ...(options === undefined ? {} : { options }) };
        const answer = await request(call);
        return answer.capability === Capability.HttpGet ? answer.value : MISMATCH;
      },
    },
    browser: {
      fetchPage: async (url) => {
        const answer = await request({ capability: Capability.BrowserFetchPage, url });
        return answer.capability === Capability.BrowserFetchPage ? answer.value : MISMATCH;
      },
    },
    logger: {
      debug: log(LogMethod.Debug),
      info: log(LogMethod.Info),
      warn: log(LogMethod.Warn),
      error: log(LogMethod.Error),
    },
    clock: { now: () => new Date() },
    shipTo: data.shipTo,
    currencyPreference: data.currencyPreference,
  };
  return { ctx, capabilities };
};

const invoke = async (store: LoadedStore["store"], request: CallRequest): Promise<unknown> => {
  const [method, argument] = request.method === CallMethod.Search
    ? [store["search"], request.query]
    : [store["fetchListing"], request.url];
  if (typeof method !== "function") {
    return err({ kind: StoreErrorKind.ParseFailed, detail: "the store has no search" });
  }
  try {
    const result: unknown = await Reflect.apply(method, store, [argument]);
    return result;
  } catch (error) {
    return err({ kind: StoreErrorKind.ParseFailed, detail: `the plugin threw: ${String(error)}` });
  }
};

const answer = async (port: WorkerPort, store: LoadedStore["store"], id: number, request: CallRequest) => {
  const result = await invoke(store, request);
  try {
    port.postMessage({ type: MessageType.CallResult, id, result });
  } catch (error) {
    const detail = `the plugin output cannot be sent: ${String(error)}`;
    port.postMessage({ type: MessageType.CallResult, id, result: err({ kind: StoreErrorKind.ParseFailed, detail }) });
  }
};

/**
 * Runs inside a plugin worker: imports the plugin, validates its exports and manifest, creates its store over a
 * context that forwards http and browser calls to the host, then posts `ready` and answers calls. Every failure is
 * posted as a message; nothing here throws.
 *
 * @param port - The worker's `parentPort`.
 * @param data - The worker's `workerData`, validated here.
 * @param load - Imports the plugin; by default `import()` from this module, so a bare package name resolves from the
 *   app's directory.
 */
export const startWorker = async (port: WorkerPort, data: unknown, load = importFromAppDir): Promise<void> => {
  const parsed = parseWorkerData(data);
  if (!parsed.ok) {
    const issue = { kind: PluginIssueKind.LoadFailed, detail: parsed.error };
    port.postMessage({ type: MessageType.LoadFailed, issue });
    return;
  }
  const { ctx, capabilities } = createContext(port, parsed.value);
  const loaded = await loadStore(parsed.value, ctx, load);
  if (!loaded.ok) {
    port.postMessage({ type: MessageType.LoadFailed, issue: loaded.error });
    return;
  }
  const { store } = loaded.value;
  port.on("message", (raw) => {
    const message = parseHostMessage(raw);
    if (!message.ok) {
      ctx.logger.error("the plugin worker ignored a message", { detail: message.error });
    } else if (message.value.type === MessageType.Call) {
      void answer(port, store, message.value.id, message.value.request);
    } else {
      capabilities.settle(message.value.id, message.value.result);
    }
  });
  port.postMessage({ type: MessageType.Ready, manifest: loaded.value.manifest });
};
