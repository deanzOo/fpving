import { pluginIdSchema } from "@fpving/core";
import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginEntry } from "../../../src/plugins/config.ts";
import { startPluginHost } from "../../../src/plugins/runtime/host.ts";
import type { PluginHost } from "../../../src/plugins/runtime/host.ts";
import { PluginIssueKind, PluginStatusKind } from "../../../src/plugins/status.ts";
import { fixturePlugin, spawnSourceWorker } from "../../support/plugin-workers.ts";
import { fakeServices } from "./fake-worker.ts";

const LOAD_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 10_000;
const HANG_TIMEOUT_MS = 300;
const GOOD = pluginIdSchema.parse("good-shop");
const CAPABLE = pluginIdSchema.parse("capable-shop");
const GARBAGE = pluginIdSchema.parse("garbage-shop");
const HANGING = pluginIdSchema.parse("hanging-shop");
const CRASHING = pluginIdSchema.parse("crashing-shop");

const startReal = (entries: readonly PluginEntry[], callTimeoutMs = CALL_TIMEOUT_MS) => {
  const { services, mocks } = fakeServices();
  const host = startPluginHost({
    entries,
    services,
    shipTo: "IL",
    currencyPreference: "USD",
    spawn: spawnSourceWorker,
    callTimeoutMs,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
  });
  return { host, mocks };
};

const statusOf = (host: PluginHost, entry: PluginEntry) =>
  host.plugins().find((plugin) => JSON.stringify(plugin.entry) === JSON.stringify(entry))?.status;

describe("Plugin workers on real threads", () => {
  const entries = {
    good: fixturePlugin("good"),
    capable: fixturePlugin("capabilities"),
    garbage: fixturePlugin("garbage"),
    throws: fixturePlugin("throws-in-create"),
    badManifest: fixturePlugin("bad-manifest"),
    zod: { package: "zod" },
    missing: { package: "fpving-plugin-that-does-not-exist" },
  };
  let host: PluginHost;
  let mocks: ReturnType<typeof fakeServices>["mocks"];

  beforeAll(async () => {
    const started = startReal(Object.values(entries));
    mocks = started.mocks;
    host = await started.host;
  });

  afterAll(async () => {
    await host.shutdown();
  });

  it("loads good plugins from their folders, by default or named exports", () => {
    expect(statusOf(host, entries.good)).toEqual({ kind: PluginStatusKind.Loaded, warnings: [] });
    expect(statusOf(host, entries.capable)).toEqual({ kind: PluginStatusKind.Loaded, warnings: [] });
    expect(host.registry.pluginFor("https://good.example/p/1")).toBe(GOOD);
  });

  it("returns a schema-valid listing and search results from a worker", async () => {
    expect(await host.fetchListing(GOOD, "https://good.example/p/1")).toEqual(ok({
      title: "Frame at https://good.example/p/1",
      itemPrice: { amountMinor: 1999, currency: "USD" },
      shipping: { kind: "unknown" },
      inStock: true,
      images: [],
    }));
    expect(await host.search(GOOD, { text: "frame" })).toEqual(ok([{ url: "https://good.example/p/1", title: "frame" }]));
    expect(mocks.info).toHaveBeenCalledWith("fetching", { url: "https://good.example/p/1", pluginId: "good-shop" });
  });

  it("serves a worker's http and browser calls with the host's ports", async () => {
    const url = "https://capable.example/p/1";
    expect(await host.fetchListing(CAPABLE, url)).toEqual(ok({
      title: "body / <p>",
      itemPrice: { amountMinor: 500, currency: "EUR" },
      shipping: { kind: "known", amountMinor: 0, currency: "EUR" },
      inStock: true,
      images: [url],
    }));
    expect(mocks.get).toHaveBeenCalledWith(url, { headers: { accept: "text/html" } });
    expect(mocks.fetchPage).toHaveBeenCalledWith(url);
    expect(mocks.warn).toHaveBeenCalledWith("fetched", { status: 200, pluginId: "capable-shop" });
  });

  it("turns garbage plugin output into parse_failed", async () => {
    const invalid = err({ kind: StoreErrorKind.ParseFailed, detail: "invalid plugin output" });
    expect(await host.fetchListing(GARBAGE, "https://garbage.example/p/1")).toEqual(invalid);
    expect(await host.search(GARBAGE, { text: "x" })).toEqual(invalid);
  });

  it.each([
    ["a createStore that throws", "throws", PluginIssueKind.LoadFailed, /^createStore threw: Error: createStore/u],
    ["a bad manifest", "badManifest", PluginIssueKind.ManifestInvalid, /^manifest: /u],
    ["a package without plugin exports", "zod", PluginIssueKind.ManifestInvalid, /must export manifest and create/u],
    ["a package that is not installed", "missing", PluginIssueKind.LoadFailed, /^cannot import the plugin: /u],
  ] as const)("disables %s with the reason", (_, key, kind, detail) => {
    const status = statusOf(host, entries[key]);
    expect(status?.kind).toBe(PluginStatusKind.Disabled);
    expect(status?.kind === PluginStatusKind.Disabled ? status.reason.kind : null).toBe(kind);
    expect(status?.kind === PluginStatusKind.Disabled ? status.reason.detail : "").toMatch(detail);
  });
});

describe("Plugin worker failures on real threads", () => {
  it("times out a hung worker, restarts it once, then disables the plugin as crashed", async () => {
    const entry = fixturePlugin("hangs");
    const { host: starting } = startReal([entry], HANG_TIMEOUT_MS);
    const host = await starting;
    const detail = `the plugin did not answer within ${String(HANG_TIMEOUT_MS)} ms`;
    const timeout = { kind: StoreErrorKind.Timeout, detail };
    expect(await host.fetchListing(HANGING, "https://hanging.example/p/1")).toEqual(err(timeout));
    expect(statusOf(host, entry)?.kind).toBe(PluginStatusKind.Loaded);
    expect(await host.fetchListing(HANGING, "https://hanging.example/p/1")).toEqual(err(timeout));
    expect(statusOf(host, entry)).toEqual({
      kind: PluginStatusKind.Disabled,
      reason: { kind: PluginIssueKind.Crashed, detail: `the plugin worker failed twice this session: ${detail}` },
    });
    await host.shutdown();
  });

  it("fails the in-flight call of a worker that throws an uncaught error, and restarts it", async () => {
    const entry = fixturePlugin("crashes");
    const { host: starting, mocks } = startReal([entry]);
    const host = await starting;
    const result = await host.fetchListing(CRASHING, "https://crashing.example/p/1");
    expect(result).toEqual(err({
      kind: StoreErrorKind.Network,
      detail: "the plugin worker failed: Error: the worker blew up",
    }));
    expect(mocks.warn).toHaveBeenCalledWith("restarting a plugin worker", {
      pluginId: "crashing-shop",
      detail: "the plugin worker failed: Error: the worker blew up",
    });
    await host.shutdown();
    await host.shutdown();
    expect(await host.fetchListing(CRASHING, "https://crashing.example/p/1")).toEqual(
      err({ kind: StoreErrorKind.Network, detail: "the plugin host is shut down" }),
    );
  });
});
