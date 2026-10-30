import { err, ok, PortErrorKind, pluginIdSchema } from "@fpving/core";
import type { DebugSink, PluginId } from "@fpving/core";
import { StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, PluginManifest, StoreResult } from "@fpving/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import type { PluginState } from "../../src/plugins/runtime/host.ts";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";
import type { PluginStatus } from "../../src/plugins/status.ts";
import {
  createPluginStoreGateway,
  GatewayRefusal,
} from "../../src/plugins/store-gateway.ts";
import type { GatewayHost } from "../../src/plugins/store-gateway.ts";
import { fakeServices, MANIFEST } from "./runtime/fake-worker.ts";

const SEARCHING: PluginManifest = { ...MANIFEST, id: "searching-shop", domains: ["searching.example"] };
const FETCHING: PluginManifest = {
  ...MANIFEST,
  id: "fetching-shop",
  domains: ["fetching.example"],
  capabilities: ["fetchListing"],
};
const CRASHED: PluginManifest = { ...MANIFEST, id: "crashed-shop", domains: ["crashed.example"] };
const SEARCHER = pluginIdSchema.parse(SEARCHING.id);
const FETCHER = pluginIdSchema.parse(FETCHING.id);
const CRASHER = pluginIdSchema.parse(CRASHED.id);
const NEVER_LOADED = pluginIdSchema.parse("never-loaded");
const URL_1 = "https://searching.example/p/1";
const LOADED: PluginStatus = { kind: PluginStatusKind.Loaded, warnings: [] };
const DISABLED: PluginStatus = {
  kind: PluginStatusKind.Disabled,
  reason: { kind: PluginIssueKind.Crashed, detail: "the plugin worker failed twice this session: boom" },
};
const LISTING: StoreResult<FetchedListing> = ok({
  title: "Frame",
  itemPrice: { amountMinor: 1999, currency: "USD" },
  shipping: { kind: "unknown" },
  inStock: true,
  images: [],
});
const CANDIDATES = ok([{ url: "https://searching.example/p/2", title: "Frame" }]);
const QUERY = { text: "frame" };
const unavailable = err({ kind: StoreErrorKind.Network, detail: GatewayRefusal.Unavailable });

const state = (manifest: PluginManifest | null, status: PluginStatus): PluginState => ({
  entry: { path: `/plugins/${manifest?.id ?? "broken"}` },
  manifest,
  status,
});

const setup = (fetched: StoreResult<FetchedListing> = LISTING, sink?: DebugSink["savePage"]) => {
  const states: PluginState[] = [
    state(SEARCHING, LOADED),
    state(FETCHING, LOADED),
    state(CRASHED, DISABLED),
    state(null, { kind: PluginStatusKind.Disabled, reason: { kind: PluginIssueKind.LoadFailed, detail: "x" } }),
  ];
  const owners = new Map<string, PluginId>([["searching.example", SEARCHER], ["crashed.example", CRASHER]]);
  const host = {
    registry: {
      declaredDomains: () => [...owners.keys()],
      pluginFor: (url: string) => owners.get(new URL(url).hostname) ?? null,
    },
    plugins: () => states,
    fetchListing: vi.fn<GatewayHost["fetchListing"]>(async () => Promise.resolve(fetched)),
    search: vi.fn<GatewayHost["search"]>(async () => Promise.resolve(CANDIDATES)),
  };
  const savePage = vi.fn<DebugSink["savePage"]>(sink ?? (async () => Promise.resolve(ok(undefined))));
  const { services, mocks } = fakeServices();
  const gateway = createPluginStoreGateway({ host, debugSink: { savePage }, logger: services.logger });
  return { gateway, host, states, savePage, warn: mocks.warn };
};

describe("Plugin store gateway", () => {
  it("lists the registry's domains and resolves URLs through it, a crashed plugin's included", () => {
    const { gateway } = setup();
    expect(gateway.declaredDomains()).toEqual(["searching.example", "crashed.example"]);
    expect(gateway.pluginFor("https://crashed.example/p/1")).toBe(CRASHER);
    expect(gateway.pluginFor("https://nobody.example/p/1")).toBeNull();
  });

  it("fetches a listing and searches through loaded plugins, returning the host's results", async () => {
    const { gateway, host } = setup();
    expect(await gateway.fetchListing(SEARCHER, URL_1)).toEqual(LISTING);
    expect(await gateway.fetchListing(FETCHER, "https://fetching.example/p/1")).toEqual(LISTING);
    expect(await gateway.search(SEARCHER, QUERY)).toEqual(CANDIDATES);
    expect(host.fetchListing).toHaveBeenCalledWith(SEARCHER, URL_1);
    expect(host.search).toHaveBeenCalledWith(SEARCHER, QUERY);
  });

  it.each([
    ["a crashed plugin", CRASHER],
    ["a plugin id no loaded plugin has", NEVER_LOADED],
  ])("answers a fetch or search through %s as unavailable without reaching a worker", async (_, pluginId) => {
    const { gateway, host } = setup();
    expect(await gateway.fetchListing(pluginId, URL_1)).toEqual(unavailable);
    expect(await gateway.search(pluginId, QUERY)).toEqual(unavailable);
    expect(host.fetchListing).not.toHaveBeenCalled();
    expect(host.search).not.toHaveBeenCalled();
  });

  it("refuses a search through a loaded plugin that does not declare search, without asking the host", async () => {
    const { gateway, host } = setup();
    expect(await gateway.search(FETCHER, QUERY)).toEqual(
      err({ kind: StoreErrorKind.Network, detail: GatewayRefusal.SearchNotDeclared }),
    );
    expect(host.search).not.toHaveBeenCalled();
  });

  it("lists as searchable only the loaded plugins whose manifest declares search, as their status changes", () => {
    const { gateway, states } = setup();
    expect(gateway.searchablePlugins()).toEqual([SEARCHER]);
    states[0] = state(SEARCHING, DISABLED);
    expect(gateway.searchablePlugins()).toEqual([]);
  });

  it("saves the raw page of a parse_failed fetch to the debug sink and returns the result unchanged", async () => {
    const failed = err({ kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: "<html>" });
    const { gateway, savePage } = setup(failed);
    expect(await gateway.fetchListing(SEARCHER, URL_1)).toEqual(failed);
    expect(savePage).toHaveBeenCalledWith(SEARCHER, URL_1, "<html>");
  });

  it.each([
    ["a parse_failed fetch without a raw page", err({ kind: StoreErrorKind.ParseFailed, detail: "no price" })],
    ["another failure", err({ kind: StoreErrorKind.Blocked, detail: "captcha" })],
    ["a listing", LISTING],
  ])("saves nothing for %s", async (_, fetched) => {
    const { gateway, savePage } = setup(fetched);
    expect(await gateway.fetchListing(SEARCHER, URL_1)).toEqual(fetched);
    expect(savePage).not.toHaveBeenCalled();
  });

  it("logs a debug page it could not save as a warning and still returns the fetch result", async () => {
    const failed = err({ kind: StoreErrorKind.ParseFailed, detail: "no price", rawPage: "<html>" });
    const refused = async () => Promise.resolve(err({ kind: PortErrorKind.DebugWriteFailed, detail: "EACCES" }));
    const { gateway, warn } = setup(failed, refused);
    expect(await gateway.fetchListing(SEARCHER, URL_1)).toEqual(failed);
    const fields = { pluginId: SEARCHER, url: URL_1, detail: "EACCES" };
    expect(warn).toHaveBeenCalledWith("could not save the debug page", fields);
  });
});
