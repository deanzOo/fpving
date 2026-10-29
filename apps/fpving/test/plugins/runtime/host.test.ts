import { pluginIdSchema } from "@fpving/core";
import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import type { PluginManifest } from "@fpving/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPluginHost } from "../../../src/plugins/runtime/host.ts";
import type { PluginHostOptions, PluginState } from "../../../src/plugins/runtime/host.ts";
import { MessageType } from "../../../src/plugins/runtime/protocol.ts";
import type { WorkerData } from "../../../src/plugins/runtime/protocol.ts";
import { PluginIssueKind, PluginStatusKind } from "../../../src/plugins/status.ts";
import { fakeServices, fakeWorker, flush, MANIFEST } from "./fake-worker.ts";
import type { FakeWorker } from "./fake-worker.ts";

const CALL_TIMEOUT_MS = 50;
const SHOP = pluginIdSchema.parse(MANIFEST.id);
const OTHER_MANIFEST: PluginManifest = { ...MANIFEST, id: "other-shop", domains: ["other.example"] };
const OTHER = pluginIdSchema.parse(OTHER_MANIFEST.id);
const SHOP_ENTRY = { path: "/plugins/example-shop" };
const OTHER_ENTRY = { package: "fpving-plugin-other" };
const URL_1 = "https://shop.example.com/p/1";
const LISTING = {
  title: "Frame",
  itemPrice: { amountMinor: 1999, currency: "USD" },
  shipping: { kind: "unknown" },
  inStock: true,
  images: [],
} as const;
const LOADED = { kind: PluginStatusKind.Loaded, warnings: [] };

type Script = (worker: FakeWorker) => void;

const readyWith = (manifest: PluginManifest): Script => (worker) => {
  queueMicrotask(() => {
    worker.ready(manifest);
  });
};

const entryKey = (data: WorkerData): string => ("path" in data.entry ? data.entry.path : data.entry.package);

const start = async (scripts: Readonly<Record<string, Script[]>>, overrides: Partial<PluginHostOptions> = {}) => {
  const workers: FakeWorker[] = [];
  const spawned = new Map<string, number>();
  const { services, mocks } = fakeServices();
  const host = await startPluginHost({
    entries: [SHOP_ENTRY, OTHER_ENTRY],
    services,
    shipTo: "IL",
    currencyPreference: "USD",
    callTimeoutMs: CALL_TIMEOUT_MS,
    spawn: (data) => {
      const worker = fakeWorker(data);
      const key = entryKey(data);
      const count = spawned.get(key) ?? 0;
      spawned.set(key, count + 1);
      workers.push(worker);
      scripts[key]?.[count]?.(worker);
      return worker.handle;
    },
    ...overrides,
  });
  const workerFor = (key: string, generation = 0): FakeWorker | undefined =>
    workers.filter((worker) => entryKey(worker.data) === key)[generation];
  return { host, workers, workerFor, mocks };
};

const both = {
  [SHOP_ENTRY.path]: [readyWith(MANIFEST), readyWith(MANIFEST)],
  [OTHER_ENTRY.package]: [readyWith(OTHER_MANIFEST)],
};

const lastCallId = (worker: FakeWorker | undefined): number => {
  const message = worker?.received.findLast(({ type }) => type === MessageType.Call);
  return message?.type === MessageType.Call ? message.id : -1;
};

const statusesOf = (plugins: readonly PluginState[]) => plugins.map(({ manifest, status }) => ({
  id: manifest?.id,
  status,
}));

describe("Plugin host loading", () => {
  it("loads every entry in its own worker and maps their domains", async () => {
    const { host, workers } = await start(both);
    expect(workers.map(({ data }) => data)).toEqual([
      { entry: SHOP_ENTRY, shipTo: "IL", currencyPreference: "USD" },
      { entry: OTHER_ENTRY, shipTo: "IL", currencyPreference: "USD" },
    ]);
    expect(host.plugins()).toEqual([
      { entry: SHOP_ENTRY, manifest: MANIFEST, status: LOADED },
      { entry: OTHER_ENTRY, manifest: OTHER_MANIFEST, status: LOADED },
    ]);
    expect(host.registry.pluginFor(URL_1)).toBe(SHOP);
    expect(host.registry.declaredDomains()).toEqual(["other.example", "shop.example.com"]);
  });

  it("disables an entry whose worker reports a load failure, with the reason", async () => {
    const issue = { kind: PluginIssueKind.ManifestInvalid, detail: "no manifest" };
    const { host, workerFor } = await start({
      ...both,
      [SHOP_ENTRY.path]: [(worker) => {
        queueMicrotask(() => {
          worker.send({ type: MessageType.LoadFailed, issue });
        });
      }],
    });
    expect(host.plugins()[0]).toEqual({
      entry: SHOP_ENTRY,
      manifest: null,
      status: { kind: PluginStatusKind.Disabled, reason: issue },
    });
    expect(workerFor(SHOP_ENTRY.path)?.terminations()).toBe(1);
    expect(await host.fetchListing(SHOP, URL_1)).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin example-shop is not loaded" }),
    );
  });

  it("disables and stops a plugin whose sdkVersion range excludes the running SDK", async () => {
    const future = { ...MANIFEST, sdkVersion: ">=9.0.0 <10.0.0" };
    const { host, workerFor } = await start({ ...both, [SHOP_ENTRY.path]: [readyWith(future)] });
    expect(host.plugins()[0]?.status).toMatchObject({
      kind: PluginStatusKind.Disabled,
      reason: { kind: PluginIssueKind.SdkIncompatible },
    });
    expect(workerFor(SHOP_ENTRY.path)?.terminations()).toBe(1);
    expect(host.registry.pluginFor(URL_1)).toBeNull();
  });

  it("disables and stops every plugin that shares an id", async () => {
    const { host, workers } = await start({ ...both, [OTHER_ENTRY.package]: [readyWith(MANIFEST)] });
    const reason = { kind: PluginIssueKind.DuplicateId, detail: "2 plugins have the id example-shop" };
    expect(host.plugins().map(({ status }) => status)).toEqual([
      { kind: PluginStatusKind.Disabled, reason },
      { kind: PluginStatusKind.Disabled, reason },
    ]);
    expect(workers.map((worker) => worker.terminations())).toEqual([1, 1]);
  });

  it("starts with no plugins when the list is empty", async () => {
    const { services } = fakeServices();
    const host = await startPluginHost({ entries: [], services, shipTo: "IL", currencyPreference: "USD" });
    expect(host.plugins()).toEqual([]);
    expect(host.registry.declaredDomains()).toEqual([]);
  });
});

describe("Plugin host calls", () => {
  it("returns a listing the plugin produced once it passes the SDK schema", async () => {
    const { host, workerFor } = await start(both);
    const result = host.fetchListing(SHOP, URL_1);
    await flush();
    const worker = workerFor(SHOP_ENTRY.path);
    expect(worker?.received).toEqual([
      { type: MessageType.Call, id: 0, request: { method: "fetchListing", url: URL_1 } },
    ]);
    worker?.answer(0, ok(LISTING));
    expect(await result).toEqual(ok(LISTING));
  });

  it("returns a store error the plugin produced", async () => {
    const { host, workerFor } = await start(both);
    const result = host.fetchListing(SHOP, URL_1);
    await flush();
    const error = { kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: "<html>" };
    workerFor(SHOP_ENTRY.path)?.answer(0, err(error));
    expect(await result).toEqual(err(error));
  });

  it("returns search candidates the plugin produced once they pass the SDK schema", async () => {
    const { host, workerFor } = await start(both);
    const query = { text: "frame", brand: "acme" };
    const result = host.search(OTHER, query);
    await flush();
    const worker = workerFor(OTHER_ENTRY.package);
    expect(worker?.received).toEqual([{ type: MessageType.Call, id: 0, request: { method: "search", query } }]);
    const candidates = [{ url: "https://other.example/p/1", title: "Frame" }];
    worker?.answer(0, ok(candidates));
    expect(await result).toEqual(ok(candidates));
  });

  it.each([
    ["a listing that fails the schema", ok({ ...LISTING, itemPrice: { amountMinor: 0, currency: "USD" } })],
    ["a store error of an unknown kind", err({ kind: "exploded", detail: "x" })],
    ["something that is not a result", "garbage"],
  ])("never trusts plugin output: %s becomes parse_failed", async (_, output) => {
    const { host, workerFor } = await start(both);
    const result = host.fetchListing(SHOP, URL_1);
    await flush();
    workerFor(SHOP_ENTRY.path)?.answer(0, output);
    expect(await result).toEqual(err({ kind: StoreErrorKind.ParseFailed, detail: "invalid plugin output" }));
  });

  it("refuses a call to a plugin it never loaded", async () => {
    const { host } = await start(both);
    const unknown = pluginIdSchema.parse("unknown-shop");
    expect(await host.search(unknown, { text: "x" })).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin unknown-shop is not loaded" }),
    );
  });
});

describe("Plugin host restarts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a hung call with timeout, restarts the worker once and routes later calls to the new one", async () => {
    const { host, workerFor, mocks } = await start(both);
    const hung = host.fetchListing(SHOP, URL_1);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    const detail = `the plugin did not answer within ${String(CALL_TIMEOUT_MS)} ms`;
    expect(await hung).toEqual(err({ kind: StoreErrorKind.Timeout, detail }));
    expect(workerFor(SHOP_ENTRY.path)?.terminations()).toBe(1);
    expect(mocks.warn).toHaveBeenCalledWith("restarting a plugin worker", { pluginId: SHOP, detail });
    const next = host.fetchListing(SHOP, URL_1);
    await flush();
    const restarted = workerFor(SHOP_ENTRY.path, 1);
    restarted?.answer(lastCallId(restarted), ok(LISTING));
    expect(await next).toEqual(ok(LISTING));
    expect(host.plugins()[0]?.status).toEqual(LOADED);
  });

  it("disables a plugin for the session when its restarted worker fails too, and tells subscribers", async () => {
    const { host, workerFor } = await start(both);
    const seen: (readonly PluginState[])[] = [];
    const unsubscribe = host.subscribe((plugins) => seen.push(plugins));
    workerFor(SHOP_ENTRY.path)?.emit("exit", 1);
    await flush();
    workerFor(SHOP_ENTRY.path, 1)?.emit("error", new Error("boom"));
    const reason = {
      kind: PluginIssueKind.Crashed,
      detail: "the plugin worker failed twice this session: the plugin worker failed: Error: boom",
    };
    const disabled = { kind: PluginStatusKind.Disabled, reason };
    expect(statusesOf(seen.flat())).toEqual([{ id: SHOP, status: disabled }, { id: OTHER, status: LOADED }]);
    expect(await host.fetchListing(SHOP, URL_1)).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin example-shop is not loaded" }),
    );
    unsubscribe();
    await host.shutdown();
    expect(seen).toHaveLength(1);
  });

  it("disables a plugin whose restarted worker does not load, and fails calls waiting for it", async () => {
    const { host, workerFor } = await start({
      ...both,
      [SHOP_ENTRY.path]: [readyWith(MANIFEST), (worker) => {
        queueMicrotask(() => {
          worker.emit("exit", 1);
        });
      }],
    });
    workerFor(SHOP_ENTRY.path)?.emit("exit", 1);
    const waiting = host.fetchListing(SHOP, URL_1);
    await flush();
    expect(await waiting).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin example-shop is not loaded" }),
    );
    expect(host.plugins()[0]?.status).toEqual({
      kind: PluginStatusKind.Disabled,
      reason: {
        kind: PluginIssueKind.Crashed,
        detail: "the plugin worker failed twice this session: the plugin worker exited with code 1",
      },
    });
  });
});

describe("Plugin host shutdown", () => {
  it("terminates every worker, fails in-flight calls and refuses later ones, idempotently", async () => {
    const { host, workers, workerFor } = await start(both);
    const inFlight = host.fetchListing(SHOP, URL_1);
    await flush();
    await Promise.all([host.shutdown(), host.shutdown()]);
    workerFor(SHOP_ENTRY.path)?.emit("exit", 1);
    expect(await inFlight).toEqual(err({ kind: StoreErrorKind.Network, detail: "the plugin worker was stopped" }));
    expect(await host.search(OTHER, { text: "x" })).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin host is shut down" }),
    );
    expect(workers.map((worker) => worker.terminations())).toEqual([1, 1]);
  });

  it("stops a worker that is still restarting and leaves the plugin's status alone", async () => {
    const { host, workerFor } = await start({ ...both, [SHOP_ENTRY.path]: [readyWith(MANIFEST)] });
    workerFor(SHOP_ENTRY.path)?.emit("exit", 1);
    const waiting = host.fetchListing(SHOP, URL_1);
    await host.shutdown();
    expect(workerFor(SHOP_ENTRY.path, 1)?.terminations()).toBe(1);
    expect(await waiting).toEqual(err({ kind: StoreErrorKind.Network, detail: "the plugin host is shut down" }));
    expect(host.plugins()[0]?.status).toEqual(LOADED);
  });
});
