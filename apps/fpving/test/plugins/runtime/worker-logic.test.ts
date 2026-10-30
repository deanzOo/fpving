import { fileURLToPath } from "node:url";
import { err, ok, PluginCapability, StoreErrorKind } from "@fpving/plugin-sdk";
import type { PluginContext, PluginManifest } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { CallMethod, Capability, LogMethod, MessageType } from "../../../src/plugins/runtime/protocol.ts";
import type { HostMessage, WorkerMessage } from "../../../src/plugins/runtime/protocol.ts";
import { startWorker } from "../../../src/plugins/runtime/worker-logic.ts";
import type { ImportModule } from "../../../src/plugins/runtime/worker-logic.ts";
import { PluginIssueKind } from "../../../src/plugins/status.ts";

const FIXTURES = fileURLToPath(new URL("../../fixtures/plugins/", import.meta.url));
const URL_1 = "https://shop.example.com/p/1";
const LISTING = {
  title: "Frame",
  itemPrice: { amountMinor: 1999, currency: "USD" },
  shipping: { kind: "unknown" },
  inStock: true,
  images: [],
};
const MANIFEST: PluginManifest = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["shop.example.com"],
  capabilities: [PluginCapability.FetchListing],
};
const DATA = { entry: { path: "/plugins/example-shop" }, shipTo: "IL", currencyPreference: "EUR" };

const fakePort = () => {
  const posted: WorkerMessage[] = [];
  const waiters: (() => void)[] = [];
  let listener: (message: unknown) => void = () => undefined;
  return {
    posted,
    postMessage: (message: WorkerMessage): void => {
      posted.push(structuredClone(message));
      waiters.splice(0).forEach((wake) => {
        wake();
      });
    },
    on: (_event: "message", next: (message: unknown) => void): void => {
      listener = next;
    },
    send: (message: HostMessage | string): void => {
      listener(message);
    },
    next: async (count: number): Promise<WorkerMessage[]> => {
      while (posted.length < count) {
        await new Promise<void>((wake) => waiters.push(wake));
      }
      return posted;
    },
  };
};

type FakePort = ReturnType<typeof fakePort>;

const exporting = (module: unknown): ImportModule => () => Promise.resolve(module);

const withStore = (store: unknown, manifest: PluginManifest = MANIFEST): ImportModule =>
  exporting({ manifest, createStore: () => store });

const started = async (load: ImportModule): Promise<FakePort> => {
  const port = fakePort();
  await startWorker(port, DATA, load);
  return port;
};

const call = async (port: FakePort, request: Extract<HostMessage, { type: "call" }>["request"]): Promise<unknown> => {
  const before = port.posted.length;
  port.send({ type: MessageType.Call, id: before, request });
  const [answer] = (await port.next(before + 1)).slice(before);
  return answer?.type === MessageType.CallResult ? answer.result : answer;
};

const capturingContext = async (): Promise<{ port: FakePort; ctx: PluginContext }> => {
  const contexts: PluginContext[] = [];
  const port = await started(exporting({
    manifest: MANIFEST,
    createStore: (ctx: PluginContext) => {
      contexts.push(ctx);
      return { fetchListing: () => Promise.resolve(ok(LISTING)) };
    },
  }));
  const [ctx] = contexts;
  if (ctx === undefined) {
    throw new Error("createStore was not called");
  }
  return { port, ctx };
};

const loadFailure = (port: FakePort): { kind: string; detail: string } => {
  const [message] = port.posted;
  return message?.type === MessageType.LoadFailed ? message.issue : { kind: "none", detail: JSON.stringify(message) };
};

const expectLoadFailure = (port: FakePort, kind: string, detail: RegExp): void => {
  const failure = loadFailure(port);
  expect(failure.kind).toBe(kind);
  expect(failure.detail).toMatch(detail);
};

const FIRST_REQUEST = 2;

const failureDetail = (result: unknown): string =>
  typeof result === "object" && result !== null && "error" in result && typeof result.error === "object"
  && result.error !== null && "detail" in result.error
    ? String(result.error.detail)
    : "";

describe("Plugin worker loading", () => {
  it("imports a folder plugin through its package.json main and reports its default-exported manifest", async () => {
    const port = fakePort();
    await startWorker(port, { ...DATA, entry: { path: `${FIXTURES}good` } });
    const [ready] = port.posted;
    expect(ready?.type === MessageType.Ready ? ready.manifest.id : ready).toBe("good-shop");
  });

  it("imports a package entry as a bare specifier resolved from the app's directory", async () => {
    const port = fakePort();
    await startWorker(port, { ...DATA, entry: { package: "zod" } });
    expectLoadFailure(port, PluginIssueKind.ManifestInvalid, /^the module must export manifest and createStore/u);
  });

  it("reports a package that cannot be resolved as load_failed with the reason", async () => {
    const port = fakePort();
    await startWorker(port, { ...DATA, entry: { package: "fpving-plugin-that-does-not-exist" } });
    expectLoadFailure(port, PluginIssueKind.LoadFailed, /^cannot import the plugin: .*fpving-plugin-that-does-not/u);
  });

  it("reports malformed worker data as load_failed", async () => {
    const port = fakePort();
    await startWorker(port, { entry: {} });
    expectLoadFailure(port, PluginIssueKind.LoadFailed, /^malformed worker data: /u);
  });

  it("accepts named manifest and createStore exports", async () => {
    const port = await started(withStore({ fetchListing: () => Promise.resolve(ok(LISTING)) }));
    expect(port.posted).toEqual([{ type: MessageType.Ready, manifest: MANIFEST }]);
  });

  it.each([
    ["no createStore", { manifest: MANIFEST }, /^the module must export manifest and createStore/u],
    ["a createStore that is not a function", { manifest: MANIFEST, createStore: {} }, /createStore/u],
    ["no exports at all", null, /^the module must export manifest and createStore/u],
    ["an invalid manifest", { manifest: { ...MANIFEST, id: "Bad Id" }, createStore: () => ({}) }, /^manifest: .*id/u],
  ])("reports a module with %s as manifest_invalid", async (_, module, detail) => {
    const port = await started(exporting(module));
    expectLoadFailure(port, PluginIssueKind.ManifestInvalid, detail);
  });

  it.each([
    ["that has no fetchListing", {}, MANIFEST],
    ["that is not an object", "store", MANIFEST],
    ["without search although the manifest declares it", { fetchListing: () => undefined }, {
      ...MANIFEST,
      capabilities: [PluginCapability.FetchListing, PluginCapability.Search],
    }],
  ])("reports a store %s as manifest_invalid", async (_, store, manifest) => {
    const port = await started(withStore(store, manifest));
    expectLoadFailure(port, PluginIssueKind.ManifestInvalid, /^createStore must return a store/u);
  });

  it("reports a createStore that throws as load_failed with the error", async () => {
    const port = await started(exporting({
      manifest: MANIFEST,
      createStore: () => {
        throw new Error("boom");
      },
    }));
    expect(loadFailure(port)).toEqual({ kind: PluginIssueKind.LoadFailed, detail: "createStore threw: Error: boom" });
  });
});

describe("Plugin worker calls", () => {
  it("answers fetchListing with whatever the store resolved to, untouched", async () => {
    const garbage = { ok: true, value: { title: 1 } };
    const port = await started(withStore({ fetchListing: () => Promise.resolve(garbage) }));
    expect(await call(port, { method: CallMethod.FetchListing, url: URL_1 })).toEqual(garbage);
  });

  it("calls store methods on the store itself, so a class-based store keeps its this", async () => {
    class ClassStore {
      readonly listing = ok(LISTING);
      fetchListing(): Promise<unknown> {
        return Promise.resolve(this.listing);
      }
    }
    const port = await started(withStore(new ClassStore()));
    expect(await call(port, { method: CallMethod.FetchListing, url: URL_1 })).toEqual(ok(LISTING));
  });

  it("answers search with the query passed through", async () => {
    const port = await started(withStore({
      fetchListing: () => undefined,
      search: (query: unknown) => Promise.resolve(ok([query])),
    }));
    const query = { text: "frame", brand: "acme" };
    expect(await call(port, { method: CallMethod.Search, query })).toEqual(ok([query]));
  });

  it("answers search on a store without search with parse_failed", async () => {
    const port = await started(withStore({ fetchListing: () => undefined }));
    expect(await call(port, { method: CallMethod.Search, query: { text: "x" } })).toEqual(
      err({ kind: StoreErrorKind.ParseFailed, detail: "the store has no search" }),
    );
  });

  it.each([
    ["throws", () => {
      throw new Error("bad");
    }],
    ["rejects", () => Promise.reject(new Error("bad"))],
  ])("answers a store method that %s with parse_failed naming the error", async (_, fetchListing) => {
    const port = await started(withStore({ fetchListing }));
    expect(await call(port, { method: CallMethod.FetchListing, url: URL_1 })).toEqual(
      err({ kind: StoreErrorKind.ParseFailed, detail: "the plugin threw: Error: bad" }),
    );
  });

  it("answers with parse_failed when the store's result cannot be sent across threads", async () => {
    const port = await started(withStore({ fetchListing: () => Promise.resolve(ok({ run: () => undefined })) }));
    const result = await call(port, { method: CallMethod.FetchListing, url: URL_1 });
    expect(result).toMatchObject({ ok: false, error: { kind: StoreErrorKind.ParseFailed } });
    expect(failureDetail(result)).toMatch(/^the plugin output cannot be sent: /u);
  });

  it("reports a malformed host message as an error log instead of crashing", async () => {
    const port = await started(withStore({ fetchListing: () => undefined }));
    port.send("garbage");
    const [, log] = port.posted;
    expect(log).toMatchObject({
      type: MessageType.Log,
      level: LogMethod.Error,
      message: "the plugin worker ignored a message",
    });
    expect(log?.type === MessageType.Log ? log.fields?.["detail"] : log).toMatch(/^malformed host message: /u);
  });
});

describe("Plugin worker context", () => {
  it("forwards http.get with its options to the host and resolves to the host's answer", async () => {
    const { port, ctx } = await capturingContext();
    const response = ctx.http.get(URL_1, { headers: { accept: "text/html" } });
    const [, request] = await port.next(FIRST_REQUEST);
    expect(request).toEqual({
      type: MessageType.CapabilityCall,
      id: 0,
      call: { capability: Capability.HttpGet, url: URL_1, options: { headers: { accept: "text/html" } } },
    });
    const value = ok({ status: 200, body: "b", headers: {} });
    port.send({ type: MessageType.CapabilityResult, id: 0, result: { capability: Capability.HttpGet, value } });
    expect(await response).toEqual(value);
  });

  it("forwards http.get without options as a call without options", async () => {
    const { port, ctx } = await capturingContext();
    void ctx.http.get(URL_1);
    const [, request] = await port.next(FIRST_REQUEST);
    expect(request).toEqual({
      type: MessageType.CapabilityCall,
      id: 0,
      call: { capability: Capability.HttpGet, url: URL_1 },
    });
  });

  it("forwards browser.fetchPage to the host and resolves to the host's answer", async () => {
    const { port, ctx } = await capturingContext();
    const page = ctx.browser.fetchPage(URL_1);
    const [, request] = await port.next(FIRST_REQUEST);
    expect(request).toEqual({
      type: MessageType.CapabilityCall,
      id: 0,
      call: { capability: Capability.BrowserFetchPage, url: URL_1 },
    });
    const value = err({ kind: StoreErrorKind.Timeout, detail: "slow" });
    const result = { capability: Capability.BrowserFetchPage, value };
    port.send({ type: MessageType.CapabilityResult, id: 0, result });
    expect(await page).toEqual(value);
  });

  it("resolves to a network error when the host answers with another capability's result", async () => {
    const { port, ctx } = await capturingContext();
    const response = ctx.http.get(URL_1);
    const page = ctx.browser.fetchPage(URL_1);
    const value = ok({ status: 200, body: "", headers: {} });
    const browserValue = ok({ status: 200, html: "", finalUrl: URL_1 });
    const browserResult = { capability: Capability.BrowserFetchPage, value: browserValue };
    port.send({ type: MessageType.CapabilityResult, id: 0, result: browserResult });
    port.send({ type: MessageType.CapabilityResult, id: 1, result: { capability: Capability.HttpGet, value } });
    const mismatch = err({ kind: StoreErrorKind.Network, detail: "the host answered another capability" });
    expect(await Promise.all([response, page])).toEqual([mismatch, mismatch]);
  });

  it("ignores a capability result for an id it never asked", async () => {
    const { port } = await capturingContext();
    const value = ok({ status: 200, body: "", headers: {} });
    port.send({ type: MessageType.CapabilityResult, id: 7, result: { capability: Capability.HttpGet, value } });
    expect(port.posted).toHaveLength(1);
  });

  it("forwards every logger method as a fire-and-forget log message", async () => {
    const { port, ctx } = await capturingContext();
    ctx.logger.debug("d");
    ctx.logger.info("i", { n: 1 });
    ctx.logger.warn("w");
    ctx.logger.error("e", { s: "x" });
    expect(port.posted.slice(1)).toEqual([
      { type: MessageType.Log, level: LogMethod.Debug, message: "d" },
      { type: MessageType.Log, level: LogMethod.Info, message: "i", fields: { n: 1 } },
      { type: MessageType.Log, level: LogMethod.Warn, message: "w" },
      { type: MessageType.Log, level: LogMethod.Error, message: "e", fields: { s: "x" } },
    ]);
  });

  it("serves the clock locally and passes the ship-to country and currency preference", async () => {
    const { ctx } = await capturingContext();
    const before = Date.now();
    expect(ctx.clock.now().getTime()).toBeGreaterThanOrEqual(before);
    expect([ctx.shipTo, ctx.currencyPreference]).toEqual([DATA.shipTo, DATA.currencyPreference]);
  });
});
