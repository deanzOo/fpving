import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import type { BrowserDriver, HttpClient, Logger, PluginManifest, Result, StoreError } from "@fpving/plugin-sdk";
import { PluginIssueKind } from "../status.js";
import type { PluginIssue } from "../status.js";
import { createPending } from "./pending.js";
import { Capability, MessageType, parseWorkerMessage } from "./protocol.js";
import type {
  CallRequest,
  CapabilityCall,
  CapabilityResult,
  HostMessage,
  WorkerData,
  WorkerMessage,
} from "./protocol.js";

interface WorkerHandle {
  postMessage(message: HostMessage): void;
  on(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  terminate(): Promise<number>;
}

/** Starts one worker for a plugin entry. */
export type SpawnWorker = (data: WorkerData) => WorkerHandle;

/** The real capabilities the host serves to workers. */
export interface HostServices {
  readonly http: HttpClient;
  readonly browser: BrowserDriver;
  readonly logger: Logger;
}

interface ConnectionOptions {
  readonly spawn: SpawnWorker;
  readonly data: WorkerData;
  readonly services: HostServices;
  readonly callTimeoutMs: number;
  readonly loadTimeoutMs: number;
  readonly onFailure: (detail: string, pluginId: string) => void;
}

/** One running plugin worker, seen from the host. */
export interface Connection {
  /** The manifest the worker reported, or why it did not load. */
  readonly loaded: Promise<Result<PluginManifest, PluginIssue>>;
  /** Sends a store call; resolves to the worker's unvalidated result, or `timeout`/`network` when it cannot answer. */
  call(request: CallRequest): Promise<Result<unknown, StoreError>>;
  /** Terminates the worker and fails every open call. Idempotent. */
  stop(): Promise<void>;
}

const STOPPED = "the plugin worker was stopped";

const serve = (services: HostServices, call: CapabilityCall): Promise<CapabilityResult> => {
  if (call.capability === Capability.BrowserFetchPage) {
    return services.browser.fetchPage(call.url).then((value) => ({ capability: call.capability, value }));
  }
  const response = call.options === undefined ? services.http.get(call.url) : services.http.get(call.url, call.options);
  return response.then((value) => ({ capability: call.capability, value }));
};

/**
 * Spawns a worker for one plugin entry and talks to it: validates every message it sends, serves its http and browser
 * calls with the real services, writes its logs with `pluginId` added, and enforces the load and call deadlines.
 *
 * @param options - The spawner, the worker data, the services, the deadlines and the failure callback.
 * @returns The connection.
 */
export const connect = (options: ConnectionOptions): Connection => {
  const { services } = options;
  const worker = options.spawn(options.data);
  const calls = createPending<Result<unknown, StoreError>>();
  let pluginId = "path" in options.data.entry ? options.data.entry.path : options.data.entry.package;
  let stopReason: string | null = null;
  let isLoaded = false;
  const load = Promise.withResolvers<Result<PluginManifest, PluginIssue>>();
  const reportLoad = (outcome: Result<PluginManifest, PluginIssue>): boolean => {
    if (isLoaded) {
      return false;
    }
    isLoaded = true;
    clearTimeout(loadTimer);
    load.resolve(outcome);
    return true;
  };

  const halt = (detail: string): boolean => {
    if (stopReason !== null) {
      return false;
    }
    stopReason = detail;
    calls.settleAll(err({ kind: StoreErrorKind.Network, detail }));
    reportLoad(err({ kind: PluginIssueKind.LoadFailed, detail }));
    return true;
  };

  const fail = (detail: string): void => {
    const wasLoaded = isLoaded;
    if (halt(detail)) {
      void worker.terminate();
      if (wasLoaded) {
        options.onFailure(detail, pluginId);
      }
    }
  };

  const loadTimer = setTimeout(() => {
    fail(`the plugin did not load within ${String(options.loadTimeoutMs)} ms`);
  }, options.loadTimeoutMs);

  const receive = (message: WorkerMessage): void => {
    switch (message.type) {
      case MessageType.Ready:
        if (reportLoad(ok(message.manifest))) {
          pluginId = message.manifest.id;
        }
        return;
      case MessageType.LoadFailed:
        if (reportLoad(err(message.issue))) {
          void stop();
        }
        return;
      case MessageType.CallResult:
        calls.settle(message.id, ok(message.result));
        return;
      case MessageType.CapabilityCall:
        if (stopReason !== null) {
          return;
        }
        void serve(services, message.call).then((result) => result, (error: unknown): CapabilityResult => {
          const detail = `the host could not serve ${message.call.capability}: ${String(error)}`;
          services.logger.warn("a plugin capability call failed", { pluginId, detail });
          return { capability: message.call.capability, value: err({ kind: StoreErrorKind.Network, detail }) };
        }).then((result) => {
          if (stopReason === null) {
            worker.postMessage({ type: MessageType.CapabilityResult, id: message.id, result });
          }
        });
        return;
      case MessageType.Log:
        services.logger[message.level](message.message, { ...message.fields, pluginId });
    }
  };

  worker.on("message", (raw) => {
    const message = parseWorkerMessage(raw);
    if (message.ok) {
      receive(message.value);
    } else {
      services.logger.warn("a plugin worker sent a malformed message", { pluginId, detail: message.error });
    }
  });
  worker.on("error", (error) => {
    fail(`the plugin worker failed: ${String(error)}`);
  });
  worker.on("exit", (code) => {
    fail(`the plugin worker exited with code ${String(code)}`);
  });

  const stop = async (): Promise<void> => {
    if (halt(STOPPED)) {
      await worker.terminate();
    }
  };

  const call = (request: CallRequest): Promise<Result<unknown, StoreError>> => {
    if (stopReason !== null) {
      return Promise.resolve(err({ kind: StoreErrorKind.Network, detail: stopReason }));
    }
    const { id, result } = calls.open();
    const detail = `the plugin did not answer within ${String(options.callTimeoutMs)} ms`;
    const timer = setTimeout(() => {
      calls.settle(id, err({ kind: StoreErrorKind.Timeout, detail }));
      fail(detail);
    }, options.callTimeoutMs);
    worker.postMessage({ type: MessageType.Call, id, request });
    return result.finally(() => {
      clearTimeout(timer);
    });
  };

  return { loaded: load.promise, call, stop };
};
