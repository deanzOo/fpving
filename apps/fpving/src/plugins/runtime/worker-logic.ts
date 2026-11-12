import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  catalogManifestSchema,
  CatalogErrorKind,
  err,
  manifestSchema,
  ok,
  PluginCapability,
  PluginKind,
  StoreErrorKind,
} from "@fpving/plugin-sdk";
import type { CatalogContext, LogFields, PluginContext, PluginManifest, Result } from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind } from "../status.js";
import { createPending } from "./pending.js";
import { CallMethod, Capability, LogMethod, MessageType, parseHostMessage, parseWorkerData } from "./protocol.js";
import type {
  CallRequest,
  CapabilityCall,
  CapabilityResult,
  LoadedManifest,
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

interface LoadedPlugin {
  readonly manifest: LoadedManifest;
  readonly target: Readonly<Record<string, unknown>>;
}

interface PluginShape<M extends LoadedManifest> {
  readonly factory: "createStore" | "createCatalog";
  readonly schema: z.ZodType<M>;
  readonly ctx: PluginContext | CatalogContext;
  readonly check: (made: unknown, manifest: M) => Result<Readonly<Record<string, unknown>>, string>;
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

const checkStore = (made: unknown, manifest: PluginManifest): Result<Readonly<Record<string, unknown>>, string> => {
  if (!isRecord(made) || typeof made["fetchListing"] !== "function") {
    return err("createStore must return a store with a fetchListing method");
  }
  return manifest.capabilities.includes(PluginCapability.Search) && typeof made["search"] !== "function"
    ? err("createStore must return a store with search, which the manifest declares")
    : ok(made);
};

const checkCatalog = (made: unknown): Result<Readonly<Record<string, unknown>>, string> =>
  isRecord(made) && typeof made["search"] === "function" && typeof made["get"] === "function"
    ? ok(made)
    : err("createCatalog must return a catalog with search and get methods");

const loadShape = <M extends LoadedManifest>(
  plugin: unknown,
  shape: PluginShape<M>,
): Result<LoadedPlugin, LoadFailure> => {
  const factory = isRecord(plugin) ? plugin[shape.factory] : undefined;
  if (!isRecord(plugin) || typeof factory !== "function") {
    return issue(PluginIssueKind.ManifestInvalid, `the module must export manifest and ${shape.factory}`);
  }
  const manifest = shape.schema.safeParse(plugin["manifest"]);
  if (!manifest.success) {
    return issue(PluginIssueKind.ManifestInvalid, `manifest: ${z.prettifyError(manifest.error)}`);
  }
  let made: unknown;
  try {
    made = Reflect.apply(factory, plugin, [shape.ctx]);
  } catch (error) {
    return issue(PluginIssueKind.LoadFailed, `${shape.factory} threw: ${String(error)}`);
  }
  const checked = shape.check(made, manifest.data);
  return checked.ok
    ? ok({ manifest: manifest.data, target: checked.value })
    : issue(PluginIssueKind.ManifestInvalid, checked.error);
};

const loadPlugin = async (
  data: WorkerData,
  ctx: PluginContext,
  load: ImportModule,
): Promise<Result<LoadedPlugin, LoadFailure>> => {
  let namespace: unknown;
  try {
    namespace = await load(data.entry);
  } catch (error) {
    return issue(PluginIssueKind.LoadFailed, `cannot import the plugin: ${String(error)}`);
  }
  const plugin = isRecord(namespace) && isRecord(namespace["default"]) ? namespace["default"] : namespace;
  const declared = isRecord(plugin) && isRecord(plugin["manifest"]) ? plugin["manifest"]["kind"] : undefined;
  return declared === PluginKind.Catalog
    ? loadShape(plugin, {
        factory: "createCatalog",
        schema: catalogManifestSchema,
        ctx: { logger: ctx.logger, clock: ctx.clock },
        check: checkCatalog,
      })
    : loadShape(plugin, { factory: "createStore", schema: manifestSchema, ctx, check: checkStore });
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

interface Invocation {
  readonly noun: "store" | "catalog";
  readonly name: string;
  readonly argument: unknown;
  readonly failure: typeof StoreErrorKind.ParseFailed | typeof CatalogErrorKind.Failed;
}

const invocationOf = (request: CallRequest): Invocation => {
  const store = { noun: "store", failure: StoreErrorKind.ParseFailed } as const;
  const catalog = { noun: "catalog", failure: CatalogErrorKind.Failed } as const;
  switch (request.method) {
    case CallMethod.FetchListing:
      return { ...store, name: "fetchListing", argument: request.url };
    case CallMethod.Search:
      return { ...store, name: "search", argument: request.query };
    case CallMethod.CatalogSearch:
      return { ...catalog, name: "search", argument: request.text };
    case CallMethod.CatalogGet:
      return { ...catalog, name: "get", argument: request.key };
  }
};

const invoke = async (target: LoadedPlugin["target"], invocation: Invocation): Promise<unknown> => {
  const method = target[invocation.name];
  if (typeof method !== "function") {
    return err({ kind: invocation.failure, detail: `the ${invocation.noun} has no ${invocation.name}` });
  }
  try {
    const result: unknown = await Reflect.apply(method, target, [invocation.argument]);
    return result;
  } catch (error) {
    return err({ kind: invocation.failure, detail: `the plugin threw: ${String(error)}` });
  }
};

const answer = async (port: WorkerPort, target: LoadedPlugin["target"], id: number, request: CallRequest) => {
  const invocation = invocationOf(request);
  const result = await invoke(target, invocation);
  try {
    port.postMessage({ type: MessageType.CallResult, id, result });
  } catch (error) {
    const detail = `the plugin output cannot be sent: ${String(error)}`;
    port.postMessage({ type: MessageType.CallResult, id, result: err({ kind: invocation.failure, detail }) });
  }
};

/**
 * Runs inside a plugin worker: imports the plugin, validates its exports and manifest, creates its store over a
 * context that forwards http and browser calls to the host, or a catalog plugin's catalog over only the logger and the
 * clock, then posts `ready` and answers calls. Every failure is posted as a message; nothing here throws.
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
  const loaded = await loadPlugin(parsed.value, ctx, load);
  if (!loaded.ok) {
    port.postMessage({ type: MessageType.LoadFailed, issue: loaded.error });
    return;
  }
  const { target } = loaded.value;
  port.on("message", (raw) => {
    const message = parseHostMessage(raw);
    if (!message.ok) {
      ctx.logger.error("the plugin worker ignored a message", { detail: message.error });
    } else if (message.value.type === MessageType.Call) {
      void answer(port, target, message.value.id, message.value.request);
    } else {
      capabilities.settle(message.value.id, message.value.result);
    }
  });
  port.postMessage({ type: MessageType.Ready, manifest: loaded.value.manifest });
};
