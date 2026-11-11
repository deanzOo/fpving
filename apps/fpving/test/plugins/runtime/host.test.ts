import { pluginIdSchema } from "@fpving/core";
import { CatalogErrorKind, err, ok, PluginKind, StoreErrorKind } from "@fpving/plugin-sdk";
import type { CatalogManifest, PluginManifest } from "@fpving/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPluginHost } from "../../../src/plugins/runtime/host.ts";
import type { PluginHost, PluginHostOptions, PluginState } from "../../../src/plugins/runtime/host.ts";
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

const readyWith = (manifest: PluginManifest | CatalogManifest): Script => (worker) => {
  queueMicrotask(() => {
    worker.ready(manifest);
  });
};

const entryKey = (data: WorkerData): string => ("path" in data.entry ? data.entry.path : data.entry.package);

const begin = (scripts: Readonly<Record<string, Script[]>>, overrides: Partial<PluginHostOptions> = {}) => {
  const workers: FakeWorker[] = [];
  const spawned = new Map<string, number>();
  const { services, mocks } = fakeServices();
  const starting = startPluginHost({
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
  return { starting, workers, workerFor, mocks };
};

const start = async (scripts: Readonly<Record<string, Script[]>>, overrides: Partial<PluginHostOptions> = {}) => {
  const { starting, ...rest } = begin(scripts, overrides);
  return { host: await starting, ...rest };
};

const both = {
  [SHOP_ENTRY.path]: [readyWith(MANIFEST), readyWith(MANIFEST)],
  [OTHER_ENTRY.package]: [readyWith(OTHER_MANIFEST)],
};

const lastCallId = (worker: FakeWorker | undefined): number => {
  const message = worker?.received.findLast(({ type }) => type === MessageType.Call);
  return message?.type === MessageType.Call ? message.id : -1;
};

const expectCallRefusedAfterRestart = async (host: PluginHost, first: FakeWorker | undefined): Promise<void> => {
  first?.emit("exit", 1);
  const waiting = host.fetchListing(SHOP, URL_1);
  await flush();
  expect(await waiting).toEqual(err({ kind: StoreErrorKind.Network, detail: "the plugin example-shop is not loaded" }));
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

describe("Plugin host startup failures", () => {
  it("reports a plugin whose worker fails before all plugins reported as crashed, and never routes it", async () => {
    const { starting, workerFor } = begin({
      [OTHER_ENTRY.package]: [readyWith(OTHER_MANIFEST), readyWith(OTHER_MANIFEST)],
    });
    await flush();
    workerFor(OTHER_ENTRY.package)?.emit("exit", 1);
    await flush();
    workerFor(OTHER_ENTRY.package, 1)?.emit("exit", 1);
    workerFor(SHOP_ENTRY.path)?.ready();
    const host = await starting;
    expect(host.plugins()[1]?.status).toEqual({
      kind: PluginStatusKind.Disabled,
      reason: {
        kind: PluginIssueKind.Crashed,
        detail: "the plugin worker failed while the plugins were starting: the plugin worker exited with code 1",
      },
    });
    expect(workerFor(OTHER_ENTRY.package, 1)).toBeUndefined();
    expect(host.registry.declaredDomains()).toEqual(["shop.example.com"]);
    expect(await host.search(OTHER, { text: "x" })).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin other-shop is not loaded" }),
    );
  });

  it("keeps an sdk_incompatible reason when that plugin's worker also fails during startup", async () => {
    const future = { ...OTHER_MANIFEST, sdkVersion: ">=9.0.0 <10.0.0" };
    const { starting, workerFor } = begin({ [OTHER_ENTRY.package]: [readyWith(future)] });
    await flush();
    workerFor(OTHER_ENTRY.package)?.emit("exit", 1);
    await flush();
    workerFor(SHOP_ENTRY.path)?.ready();
    const host = await starting;
    await flush();
    expect(host.plugins()[1]?.status).toMatchObject({
      kind: PluginStatusKind.Disabled,
      reason: { kind: PluginIssueKind.SdkIncompatible },
    });
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

  it("refuses search, without asking the worker, for a plugin whose manifest does not declare it", async () => {
    const fetchOnly = { ...MANIFEST, capabilities: ["fetchListing"] } satisfies PluginManifest;
    const { host, workerFor } = await start({ ...both, [SHOP_ENTRY.path]: [readyWith(fetchOnly)] });
    expect(await host.search(SHOP, { text: "x" })).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin example-shop does not declare search" }),
    );
    expect(workerFor(SHOP_ENTRY.path)?.received).toEqual([]);
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
    await expectCallRefusedAfterRestart(host, workerFor(SHOP_ENTRY.path));
    expect(host.plugins()[0]?.status).toEqual({
      kind: PluginStatusKind.Disabled,
      reason: {
        kind: PluginIssueKind.Crashed,
        detail: "the plugin worker failed twice this session: the plugin worker exited with code 1",
      },
    });
  });
});

describe("Plugin host restarts with a changed plugin", () => {
  it("disables a plugin whose restarted worker reports a different manifest instead of routing to it", async () => {
    const changed = { ...MANIFEST, version: "2.0.0" };
    const { host, workerFor } = await start({ ...both, [SHOP_ENTRY.path]: [readyWith(MANIFEST), readyWith(changed)] });
    await expectCallRefusedAfterRestart(host, workerFor(SHOP_ENTRY.path));
    expect(workerFor(SHOP_ENTRY.path, 1)?.received).toEqual([]);
    expect(workerFor(SHOP_ENTRY.path, 1)?.terminations()).toBe(1);
    expect(host.plugins()[0]?.status).toEqual({
      kind: PluginStatusKind.Disabled,
      reason: {
        kind: PluginIssueKind.ManifestInvalid,
        detail: "the restarted plugin reported a different manifest than it loaded with",
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

const CATALOG_MANIFEST: CatalogManifest = {
  kind: PluginKind.Catalog,
  id: "example-catalog",
  displayName: "Example Catalog",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
};
const CATALOG = pluginIdSchema.parse(CATALOG_MANIFEST.id);
const CATALOG_ENTRY = { package: "fpving-catalog-example" };
const BOXER = { key: "boxer-crush", name: "Boxer Crush", specs: { kind: "radio", rcLink: "elrs-2g4" } } as const;
const BROKEN = { key: "broken", name: "Broken", specs: { kind: "radio", rcLink: "smoke-signals" } };
const withCatalog = {
  [SHOP_ENTRY.path]: [readyWith(MANIFEST)],
  [CATALOG_ENTRY.package]: [readyWith(CATALOG_MANIFEST), readyWith(CATALOG_MANIFEST)],
};
const catalogFailure = (detail: string) => err({ kind: CatalogErrorKind.Failed, detail });

const startWithCatalog = async (scripts: Readonly<Record<string, Script[]>> = withCatalog) =>
  start(scripts, { entries: [SHOP_ENTRY, CATALOG_ENTRY] });

const answerCatalog = async (
  asking: Promise<unknown>,
  worker: FakeWorker | undefined,
  output: unknown,
): Promise<unknown> => {
  await flush();
  worker?.answer(lastCallId(worker), output);
  return asking;
};

describe("Plugin host catalog plugins", () => {
  it("loads a catalog plugin beside a store without giving it domains, and lists it as a catalog", async () => {
    const { host } = await startWithCatalog();
    expect(host.plugins()).toEqual([
      { entry: SHOP_ENTRY, manifest: MANIFEST, status: LOADED },
      { entry: CATALOG_ENTRY, manifest: CATALOG_MANIFEST, status: LOADED },
    ]);
    expect(host.registry.declaredDomains()).toEqual(["shop.example.com"]);
    expect(host.catalogPlugins()).toEqual([CATALOG]);
  });

  it("searches a catalog in its worker, keeping entries that pass the schema and warning per drop", async () => {
    const { host, workerFor, mocks } = await startWithCatalog();
    const worker = workerFor(CATALOG_ENTRY.package);
    const found = await answerCatalog(host.searchCatalog(CATALOG, "boxer"), worker, ok([BOXER, BROKEN, "junk"]));
    expect(worker?.received).toEqual([
      { type: MessageType.Call, id: 0, request: { method: "catalog.search", text: "boxer" } },
    ]);
    expect(found).toEqual(ok([BOXER]));
    expect(mocks.warn).toHaveBeenCalledTimes([BROKEN, "junk"].length);
    expect(mocks.warn).toHaveBeenCalledWith("dropped an invalid catalog entry", expect.objectContaining({
      pluginId: CATALOG,
    }));
  });

  it.each([
    ["an entry", ok(BOXER), ok(BOXER)],
    ["no entry", ok(null), ok(null)],
    ["an entry that fails the schema as no entry", ok(BROKEN), ok(null)],
    ["the catalog's own error", catalogFailure("offline"), catalogFailure("offline")],
    ["output that is not a result as failed", "garbage", catalogFailure("invalid plugin output")],
  ])("gets a catalog entry by key and returns %s", async (_, output, expected) => {
    const { host, workerFor } = await startWithCatalog();
    const worker = workerFor(CATALOG_ENTRY.package);
    expect(await answerCatalog(host.getCatalogEntry(CATALOG, BOXER.key), worker, output)).toEqual(expected);
    expect(worker?.received).toEqual([
      { type: MessageType.Call, id: 0, request: { method: "catalog.get", key: BOXER.key } },
    ]);
  });

  it("refuses a catalog call to a store and a store call to a catalog without reaching either worker", async () => {
    const { host, workerFor } = await startWithCatalog();
    expect(await host.searchCatalog(SHOP, "x")).toEqual(catalogFailure("the plugin example-shop is not loaded"));
    expect(await host.getCatalogEntry(SHOP, "x")).toEqual(catalogFailure("the plugin example-shop is not loaded"));
    const notLoaded = err({ kind: StoreErrorKind.Network, detail: "the plugin example-catalog is not loaded" });
    expect(await host.fetchListing(CATALOG, URL_1)).toEqual(notLoaded);
    expect(await host.search(CATALOG, { text: "x" })).toEqual(notLoaded);
    expect([workerFor(SHOP_ENTRY.path)?.received, workerFor(CATALOG_ENTRY.package)?.received]).toEqual([[], []]);
  });

  it("disables a catalog plugin whose sdkVersion range excludes the running SDK and does not list it", async () => {
    const future = { ...CATALOG_MANIFEST, sdkVersion: ">=9.0.0 <10.0.0" };
    const { host } = await startWithCatalog({ ...withCatalog, [CATALOG_ENTRY.package]: [readyWith(future)] });
    expect(host.plugins()[1]?.status).toMatchObject({
      kind: PluginStatusKind.Disabled,
      reason: { kind: PluginIssueKind.SdkIncompatible },
    });
    expect(host.catalogPlugins()).toEqual([]);
  });

  it("restarts a failed catalog worker like a store's and routes later catalog calls to the new one", async () => {
    const { host, workerFor } = await startWithCatalog();
    workerFor(CATALOG_ENTRY.package)?.emit("exit", 1);
    const asking = host.searchCatalog(CATALOG, "boxer");
    expect(await answerCatalog(asking, workerFor(CATALOG_ENTRY.package, 1), ok([BOXER]))).toEqual(ok([BOXER]));
    workerFor(CATALOG_ENTRY.package, 1)?.emit("exit", 1);
    expect(host.catalogPlugins()).toEqual([]);
    expect(host.plugins()[1]?.status).toMatchObject({ reason: { kind: PluginIssueKind.Crashed } });
  });

  it("answers a catalog call its worker cannot answer with a failed catalog error", async () => {
    const { host, workerFor } = await startWithCatalog();
    const asking = host.getCatalogEntry(CATALOG, BOXER.key);
    await flush();
    workerFor(CATALOG_ENTRY.package)?.emit("exit", 1);
    expect(await asking).toEqual(catalogFailure("the plugin worker exited with code 1"));
  });
});
