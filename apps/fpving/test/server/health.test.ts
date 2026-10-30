import { afterEach, describe, expect, it } from "vitest";
import type { PluginState } from "../../src/plugins/runtime/host.ts";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";
import { HEALTH_PATH, healthSchema, registerHealthRoute } from "../../src/server/health.ts";
import { createServer } from "../../src/server/server.ts";
import type { AppServer } from "../../src/server/server.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const PORT = 4321;
const OK = 200;
const VERSION = "1.2.3";
const REJECTED = 2;
const HOST = { host: `localhost:${String(PORT)}` };
const issue = { kind: PluginIssueKind.Crashed, detail: "exited" };
const loaded: PluginState = {
  entry: { path: "/plugins/a" },
  manifest: null,
  status: { kind: PluginStatusKind.Loaded, warnings: [] },
};
const disabled: PluginState = {
  entry: { path: "/plugins/b" },
  manifest: null,
  status: { kind: PluginStatusKind.Disabled, reason: issue },
};

describe("Health route", () => {
  let server: AppServer | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("reports the version and the loaded and disabled plugin counts, rejected entries as disabled", async () => {
    let states: readonly PluginState[] = [loaded, disabled, loaded];
    server = createServer({ port: PORT, logger: recordingLogger() });
    registerHealthRoute(server, { version: VERSION, plugins: () => states, rejectedEntries: REJECTED });
    const get = async () => server?.inject({ method: "GET", url: HEALTH_PATH, headers: HOST });
    const first = await get();
    expect(first?.statusCode).toBe(OK);
    const plugins = { loaded: 2, disabled: 1 + REJECTED };
    expect(healthSchema.parse(first?.json())).toEqual({ ok: true, version: VERSION, plugins });
    states = [disabled];
    expect((await get())?.json()).toEqual({ ok: true, version: VERSION, plugins: { ...plugins, loaded: 0 } });
  });
});
