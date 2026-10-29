import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../../../src/plugins/runtime/connection.ts";
import { CallMethod, Capability, LogMethod, MessageType } from "../../../src/plugins/runtime/protocol.ts";
import { PluginIssueKind } from "../../../src/plugins/status.ts";
import { DATA, fakeServices, fakeWorker, flush, MANIFEST } from "./fake-worker.ts";

const CALL_TIMEOUT_MS = 50;
const LOAD_TIMEOUT_MS = 80;
const URL_1 = "https://shop.example.com/p/1";
const FETCH = { method: CallMethod.FetchListing, url: URL_1 } as const;

const OPTIONS = { callTimeoutMs: CALL_TIMEOUT_MS, loadTimeoutMs: LOAD_TIMEOUT_MS };

const WORKER_DEATHS = [
  ["errors", "error", new Error("boom"), "the plugin worker failed: Error: boom"],
  ["exits", "exit", 1, "the plugin worker exited with code 1"],
] as const;

const setup = () => {
  const worker = fakeWorker();
  const { services, mocks } = fakeServices();
  const failures: string[] = [];
  const connection = connect({
    spawn: (data) => {
      expect(data).toEqual(DATA);
      return worker.handle;
    },
    data: DATA,
    services,
    callTimeoutMs: CALL_TIMEOUT_MS,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
    onFailure: (detail) => failures.push(detail),
  });
  return { worker, mocks, failures, connection };
};

const loadedSetup = async () => {
  const context = setup();
  context.worker.ready();
  await context.connection.loaded;
  return context;
};

const UNKNOWN_ID = 9;
const HALF_DEADLINE = CALL_TIMEOUT_MS / (1 + 1);
const HTTP_ID = 3;

describe("Plugin worker connection loading", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to the manifest the worker reports", async () => {
    const { worker, connection } = setup();
    worker.ready();
    expect(await connection.loaded).toEqual(ok(MANIFEST));
  });

  it("resolves to the worker's load failure and terminates the worker", async () => {
    const { worker, connection, failures } = setup();
    const issue = { kind: PluginIssueKind.ManifestInvalid, detail: "no manifest" };
    worker.send({ type: MessageType.LoadFailed, issue });
    expect(await connection.loaded).toEqual(err(issue));
    expect(worker.terminations()).toBe(1);
    worker.emit("exit", 0);
    expect(failures).toEqual([]);
  });

  it.each(WORKER_DEATHS)("fails the load as load_failed when the worker %s before reporting", async (...death) => {
    const [, event, value, detail] = death;
    const { worker, connection, failures } = setup();
    worker.emit(event, value);
    expect(await connection.loaded).toEqual(err({ kind: PluginIssueKind.LoadFailed, detail }));
    expect(failures).toEqual([]);
  });

  it("fails the load as load_failed and terminates a worker that does not report in time", async () => {
    const { worker, connection } = setup();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    expect(await connection.loaded).toEqual(
      err({ kind: PluginIssueKind.LoadFailed, detail: `the plugin did not load within ${String(LOAD_TIMEOUT_MS)} ms` }),
    );
    expect(worker.terminations()).toBe(1);
  });

  it("keeps the first report when a worker reports twice", async () => {
    const { worker, connection } = setup();
    worker.ready();
    worker.ready({ ...MANIFEST, id: "other-shop" });
    worker.send({ type: MessageType.LoadFailed, issue: { kind: PluginIssueKind.LoadFailed, detail: "late" } });
    expect(await connection.loaded).toEqual(ok(MANIFEST));
    expect(worker.terminations()).toBe(0);
  });
});

describe("Plugin worker connection calls", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a call with its own id and resolves to the worker's raw result", async () => {
    const { worker, connection } = await loadedSetup();
    const first = connection.call(FETCH);
    const second = connection.call({ method: CallMethod.Search, query: { text: "frame" } });
    expect(worker.received).toEqual([
      { type: MessageType.Call, id: 0, request: FETCH },
      { type: MessageType.Call, id: 1, request: { method: CallMethod.Search, query: { text: "frame" } } },
    ]);
    worker.answer(1, "two");
    worker.answer(0, { anything: 1 });
    worker.answer(UNKNOWN_ID, "unknown id");
    expect(await Promise.all([first, second])).toEqual([ok({ anything: 1 }), ok("two")]);
  });

  it("resolves a call past its deadline with timeout, fails the rest and reports the worker as failed", async () => {
    const { worker, connection, failures } = await loadedSetup();
    const slow = connection.call(FETCH);
    await vi.advanceTimersByTimeAsync(HALF_DEADLINE);
    const other = connection.call(FETCH);
    await vi.advanceTimersByTimeAsync(HALF_DEADLINE);
    const detail = `the plugin did not answer within ${String(CALL_TIMEOUT_MS)} ms`;
    expect(await slow).toEqual(err({ kind: StoreErrorKind.Timeout, detail }));
    expect(await other).toEqual(err({ kind: StoreErrorKind.Network, detail }));
    expect(worker.terminations()).toBe(1);
    expect(failures).toEqual([detail]);
  });

  it("clears a call's deadline once it is answered", async () => {
    const { worker, connection, failures } = await loadedSetup();
    const call = connection.call(FETCH);
    worker.answer(0, "done");
    await call;
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(failures).toEqual([]);
  });

  it.each(WORKER_DEATHS)("fails in-flight calls and reports one failure when the worker %s", async (...death) => {
    const [, event, value, detail] = death;
    const { worker, connection, failures } = await loadedSetup();
    const call = connection.call(FETCH);
    worker.emit(event, value);
    worker.emit("exit", 1);
    expect(await call).toEqual(err({ kind: StoreErrorKind.Network, detail }));
    expect(await connection.call(FETCH)).toEqual(err({ kind: StoreErrorKind.Network, detail }));
    expect(failures).toEqual([detail]);
  });

  it("stops idempotently: terminates once, fails in-flight calls and ignores the exit it caused", async () => {
    const { worker, connection, failures } = await loadedSetup();
    const call = connection.call(FETCH);
    await Promise.all([connection.stop(), connection.stop()]);
    worker.emit("exit", 1);
    const stopped = err({ kind: StoreErrorKind.Network, detail: "the plugin worker was stopped" });
    expect(await call).toEqual(stopped);
    expect(await connection.call(FETCH)).toEqual(stopped);
    expect(worker.terminations()).toBe(1);
    expect(failures).toEqual([]);
  });

  it("fails the load when stopped before the worker reports", async () => {
    const { connection } = setup();
    await connection.stop();
    expect(await connection.loaded).toEqual(
      err({ kind: PluginIssueKind.LoadFailed, detail: "the plugin worker was stopped" }),
    );
  });
});

describe("Plugin worker connection capabilities", () => {
  it("serves http.get through the injected HttpClient and posts the result back", async () => {
    const { worker, mocks } = await loadedSetup();
    const call = { capability: Capability.HttpGet, url: URL_1, options: { headers: { accept: "x" } } };
    worker.send({ type: MessageType.CapabilityCall, id: HTTP_ID, call });
    const bare = { capability: Capability.HttpGet, url: URL_1 };
    worker.send({ type: MessageType.CapabilityCall, id: HTTP_ID + 1, call: bare });
    await flush();
    expect(mocks.get.mock.calls).toEqual([[URL_1, { headers: { accept: "x" } }], [URL_1]]);
    const value = ok({ status: 200, body: "body", headers: {} });
    expect(worker.received).toEqual([
      { type: MessageType.CapabilityResult, id: HTTP_ID, result: { capability: Capability.HttpGet, value } },
      { type: MessageType.CapabilityResult, id: HTTP_ID + 1, result: { capability: Capability.HttpGet, value } },
    ]);
  });

  it("serves browser.fetchPage through the injected BrowserDriver and posts the result back", async () => {
    const { worker, mocks } = await loadedSetup();
    const call = { capability: Capability.BrowserFetchPage, url: URL_1 };
    worker.send({ type: MessageType.CapabilityCall, id: 0, call });
    await flush();
    expect(mocks.fetchPage).toHaveBeenCalledWith(URL_1);
    const value = ok({ status: 200, html: "<p>", finalUrl: URL_1 });
    expect(worker.received).toEqual([
      { type: MessageType.CapabilityResult, id: 0, result: { capability: Capability.BrowserFetchPage, value } },
    ]);
  });

  it("drops a capability result when the worker stopped in the meantime", async () => {
    const { worker, connection } = await loadedSetup();
    worker.send({ type: MessageType.CapabilityCall, id: 0, call: { capability: Capability.HttpGet, url: URL_1 } });
    await connection.stop();
    await flush();
    expect(worker.received).toEqual([]);
  });

  it("writes plugin logs through the injected Logger with the plugin id added", async () => {
    const { worker, mocks } = await loadedSetup();
    worker.send({ type: MessageType.Log, level: LogMethod.Warn, message: "hm", fields: { n: 1 } });
    worker.send({ type: MessageType.Log, level: LogMethod.Debug, message: "d" });
    expect(mocks.warn).toHaveBeenCalledWith("hm", { n: 1, pluginId: MANIFEST.id });
    expect(mocks.debug).toHaveBeenCalledWith("d", { pluginId: MANIFEST.id });
  });

  it("names the plugin by its package in logs sent before it reports", () => {
    const worker = fakeWorker();
    const { services, mocks } = fakeServices();
    const data = { ...DATA, entry: { package: "fpving-plugin-x" } };
    connect({ ...OPTIONS, spawn: () => worker.handle, data, services, onFailure: () => undefined });
    worker.send({ type: MessageType.Log, level: LogMethod.Info, message: "early" });
    expect(mocks.info).toHaveBeenCalledWith("early", { pluginId: "fpving-plugin-x" });
  });

  it("names the plugin by its folder in logs sent before it reports", () => {
    const { worker, mocks } = setup();
    worker.send({ type: MessageType.Log, level: LogMethod.Info, message: "early" });
    expect(mocks.info).toHaveBeenCalledWith("early", { pluginId: "/plugins/example-shop" });
  });

  it("logs a malformed message as a warning instead of crashing", async () => {
    const { worker, mocks } = await loadedSetup();
    worker.send({ type: "explode" });
    const [[message, fields] = []] = mocks.warn.mock.calls;
    expect(message).toBe("a plugin worker sent a malformed message");
    expect(fields).toMatchObject({ pluginId: MANIFEST.id });
    expect(JSON.stringify(fields)).toMatch(/"detail":"malformed worker message: /u);
  });
});
