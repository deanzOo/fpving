import { ok } from "@fpving/plugin-sdk";
import type { BrowserDriver, HttpClient, Logger, PluginManifest } from "@fpving/plugin-sdk";
import { vi } from "vitest";
import type { Mock } from "vitest";
import { MessageType } from "../../../src/plugins/runtime/protocol.ts";
import type { HostMessage, WorkerData } from "../../../src/plugins/runtime/protocol.ts";
import type { HostServices, SpawnWorker } from "../../../src/plugins/runtime/connection.ts";

export const MANIFEST: PluginManifest = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["shop.example.com"],
  capabilities: ["fetchListing", "search"],
};

export const DATA: WorkerData = { entry: { path: "/plugins/example-shop" }, shipTo: "IL", currencyPreference: "USD" };

type WorkerEvent = "message" | "error" | "exit";

/** A scripted stand-in for a `node:worker_threads` Worker. */
export const fakeWorker = (data: WorkerData = DATA) => {
  const listeners = new Map<WorkerEvent, ((value: unknown) => void)[]>();
  const received: HostMessage[] = [];
  let terminated = 0;
  const emit = (event: WorkerEvent, value: unknown): void => {
    (listeners.get(event) ?? []).forEach((listener) => {
      listener(value);
    });
  };
  const handle: ReturnType<SpawnWorker> = {
    postMessage: (message) => {
      received.push(message);
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    terminate: () => {
      terminated += 1;
      return Promise.resolve(1);
    },
  };
  return {
    data,
    handle,
    received,
    terminations: () => terminated,
    emit,
    send: (message: unknown) => {
      emit("message", message);
    },
    ready: (manifest: PluginManifest = MANIFEST) => {
      emit("message", { type: MessageType.Ready, manifest });
    },
    answer: (id: number, result: unknown) => {
      emit("message", { type: MessageType.CallResult, id, result });
    },
  };
};

export type FakeWorker = ReturnType<typeof fakeWorker>;

interface ServiceMocks {
  readonly debug: Mock<Logger["debug"]>;
  readonly info: Mock<Logger["info"]>;
  readonly warn: Mock<Logger["warn"]>;
  readonly error: Mock<Logger["error"]>;
  readonly get: Mock<HttpClient["get"]>;
  readonly fetchPage: Mock<BrowserDriver["fetchPage"]>;
}

/** Fake host services, with their mocks. */
export const fakeServices = (): { services: HostServices; mocks: ServiceMocks } => {
  const mocks: ServiceMocks = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    get: vi.fn<HttpClient["get"]>(() => Promise.resolve(ok({ status: 200, body: "body", headers: {} }))),
    fetchPage: vi.fn<BrowserDriver["fetchPage"]>(
      (url) => Promise.resolve(ok({ status: 200, html: "<p>", finalUrl: url })),
    ),
  };
  const logger: Logger = { debug: mocks.debug, info: mocks.info, warn: mocks.warn, error: mocks.error };
  return { services: { logger, http: { get: mocks.get }, browser: { fetchPage: mocks.fetchPage } }, mocks };
};

/** Lets queued promise callbacks run. */
export const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};
