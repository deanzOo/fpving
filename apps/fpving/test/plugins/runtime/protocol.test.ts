import { describe, expect, it } from "vitest";
import {
  Capability,
  CallMethod,
  LogMethod,
  MessageType,
  parseHostMessage,
  parseWorkerData,
  parseWorkerMessage,
} from "../../../src/plugins/runtime/protocol.ts";
import { PluginIssueKind } from "../../../src/plugins/status.ts";

const MANIFEST = {
  id: "example-shop",
  displayName: "Example Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["shop.example.com"],
  capabilities: ["fetchListing"],
};

describe("Plugin worker protocol", () => {
  it.each([
    { type: MessageType.Ready, manifest: MANIFEST },
    { type: MessageType.LoadFailed, issue: { kind: PluginIssueKind.ManifestInvalid, detail: "no manifest" } },
    { type: MessageType.CallResult, id: 0, result: { anything: "goes" } },
    { type: MessageType.CapabilityCall, id: 1, call: { capability: Capability.HttpGet, url: "https://a.example/" } },
    {
      type: MessageType.CapabilityCall,
      id: 2,
      call: { capability: Capability.HttpGet, url: "https://a.example/", options: { headers: { accept: "x" } } },
    },
    {
      type: MessageType.CapabilityCall,
      id: 3,
      call: { capability: Capability.BrowserFetchPage, url: "https://a.example/" },
    },
    { type: MessageType.Log, level: LogMethod.Info, message: "hi" },
    { type: MessageType.Log, level: LogMethod.Warn, message: "m", fields: { n: 1, s: "x", b: true, z: null } },
  ])("accepts the worker message %j", (message) => {
    expect(parseWorkerMessage(message)).toEqual({ ok: true, value: message });
  });

  it.each([
    ["an unknown type", { type: "explode" }],
    ["a ready message with an invalid manifest", { type: MessageType.Ready, manifest: { id: "Bad Id" } }],
    ["a call result without an id", { type: MessageType.CallResult, result: 1 }],
    ["a negative id", { type: MessageType.CallResult, id: -1, result: 1 }],
    ["an unknown capability", { type: MessageType.CapabilityCall, id: 1, call: { capability: "fs.read", url: "/" } }],
    ["an object log field", { type: MessageType.Log, level: LogMethod.Info, message: "m", fields: { o: {} } }],
    ["a load failure of a kind a worker cannot report", {
      type: MessageType.LoadFailed,
      issue: { kind: PluginIssueKind.DomainConflict, detail: "x" },
    }],
    ["something that is not an object", "ready"],
  ])("refuses a worker message with %s as a typed failure", (_, message) => {
    const parsed = parseWorkerMessage(message);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toMatch(/^malformed worker message: ./u);
  });

  it.each([
    { type: MessageType.Call, id: 0, request: { method: CallMethod.FetchListing, url: "https://a.example/p" } },
    { type: MessageType.Call, id: 1, request: { method: CallMethod.Search, query: { text: "frame", brand: "x" } } },
    {
      type: MessageType.CapabilityResult,
      id: 0,
      result: { capability: Capability.HttpGet, value: { ok: true, value: { status: 200, body: "b", headers: {} } } },
    },
    {
      type: MessageType.CapabilityResult,
      id: 1,
      result: {
        capability: Capability.BrowserFetchPage,
        value: { ok: true, value: { status: 200, html: "<p>", finalUrl: "https://a.example/" } },
      },
    },
    {
      type: MessageType.CapabilityResult,
      id: 2,
      result: { capability: Capability.HttpGet, value: { ok: false, error: { kind: "timeout", detail: "slow" } } },
    },
  ])("accepts the host message %j", (message) => {
    expect(parseHostMessage(message)).toEqual({ ok: true, value: message });
  });

  it.each([
    ["an unknown method", { type: MessageType.Call, id: 0, request: { method: "delete", url: "x" } }],
    ["a transport error of a store-only kind", {
      type: MessageType.CapabilityResult,
      id: 0,
      result: { capability: Capability.HttpGet, value: { ok: false, error: { kind: "blocked", detail: "x" } } },
    }],
    ["a browser page given as an http result", {
      type: MessageType.CapabilityResult,
      id: 0,
      result: { capability: Capability.HttpGet, value: { ok: true, value: { status: 200, html: "", finalUrl: "" } } },
    }],
  ])("refuses a host message with %s as a typed failure", (_, message) => {
    const parsed = parseHostMessage(message);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toMatch(/^malformed host message: ./u);
  });

  it("accepts worker data naming a folder or a package with the context settings", () => {
    const data = { entry: { path: "/plugins/shop" }, shipTo: "IL", currencyPreference: "USD" };
    expect(parseWorkerData(data)).toEqual({ ok: true, value: data });
    const byPackage = { ...data, entry: { package: "fpving-plugin-shop" } };
    expect(parseWorkerData(byPackage)).toEqual({ ok: true, value: byPackage });
  });

  it("refuses worker data with an unknown country as a typed failure", () => {
    const parsed = parseWorkerData({ entry: { path: "/p" }, shipTo: "XX", currencyPreference: "USD" });
    expect(parsed.ok ? "" : parsed.error).toMatch(/^malformed worker data: ./u);
  });
});
