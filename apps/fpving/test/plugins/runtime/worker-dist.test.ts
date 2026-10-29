import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { pluginIdSchema } from "@fpving/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnWorker, startPluginHost, WORKER_ENTRY } from "../../../src/plugins/runtime/host.ts";
import type { PluginHost } from "../../../src/plugins/runtime/host.ts";
import { PluginStatusKind } from "../../../src/plugins/status.ts";
import { fixturePlugin } from "../../support/plugin-workers.ts";
import { fakeServices } from "./fake-worker.ts";

const BUILD_TIMEOUT_MS = 180_000;
const LOAD_TIMEOUT_MS = 20_000;
const APP = new URL("../../../", import.meta.url);
const DIST_WORKER_ENTRY = new URL("dist/plugins/runtime/worker-entry.js", APP);
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

describe("Plugin worker entry from the build", () => {
  let host: PluginHost;

  beforeAll(async () => {
    await promisify(execFile)(process.execPath, [tsc, "-b", fileURLToPath(new URL("tsconfig.json", APP))]);
    const { services } = fakeServices();
    host = await startPluginHost({
      entries: [fixturePlugin("good")],
      services,
      shipTo: "IL",
      currencyPreference: "USD",
      spawn: spawnWorker(DIST_WORKER_ENTRY),
      loadTimeoutMs: LOAD_TIMEOUT_MS,
    });
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await host.shutdown();
  });

  it("is the default entry the host spawns: the built worker-entry.js next to the host module", () => {
    expect(WORKER_ENTRY.href.endsWith("/plugins/runtime/worker-entry.js")).toBe(true);
  });

  it("runs on plain Node without the source condition or loader hooks", async () => {
    expect(host.plugins()[0]?.status.kind).toBe(PluginStatusKind.Loaded);
    const result = await host.fetchListing(pluginIdSchema.parse("good-shop"), "https://good.example/p/1");
    expect(result.ok).toBe(true);
  });
});
