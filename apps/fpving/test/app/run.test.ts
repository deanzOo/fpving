import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCode, SHUTDOWN_MESSAGE } from "../../src/app/lifecycle.ts";
import { runApp } from "../../src/app/run.ts";
import type { ClosableBrowserDriver } from "../../src/adapters/transport/playwright-browser-driver.ts";
import type { AppPorts } from "../../src/app/start.ts";
import { PLUGINS_FILE } from "../../src/plugins/config.ts";
import type { SpawnWorker } from "../../src/plugins/runtime/connection.ts";
import { fakeWorker } from "../plugins/runtime/fake-worker.ts";
import { fakePorts, freePort, occupy } from "../support/app-fixtures.ts";
import { fixturePlugin } from "../support/plugin-workers.ts";

let root = "";
let port = 0;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "fpving-run-"));
  port = await freePort();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const run = (env: Record<string, string>, overrides: Partial<AppPorts>) => {
  const events = new EventEmitter();
  const exit = vi.fn();
  let out = "";
  let err = "";
  const done = runApp({
    env,
    overrides,
    events,
    exit,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { events, exit, done, out: () => out, err: () => err };
};

const env = (): Record<string, string> => ({ PORT: String(port), DATA_DIR: join(root, "data") });

describe("Running the app", () => {
  it("prints where it listens, then shuts down cleanly on SIGTERM", async () => {
    const running = run(env(), fakePorts().ports);
    await running.done;
    expect(running.out()).toBe(`fpving listening on http://127.0.0.1:${String(port)}\n`);
    running.events.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(running.exit).toHaveBeenCalledWith(ExitCode.Clean);
    });
    await (await occupy(port))();
  });

  it("prints one line and exits 1 when it cannot start", async () => {
    const running = run({ PORT: "nope", DATA_DIR: join(root, "data") }, {});
    await running.done;
    expect(running.err()).toMatch(/^fpving did not start: Invalid environment: PORT: [^\n]*\n$/u);
    expect(running.exit).toHaveBeenCalledWith(ExitCode.Failed);
  });

  it("cancels a startup on the IPC shutdown message while plugins load, cleans up and exits cleanly", async () => {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", PLUGINS_FILE), JSON.stringify([fixturePlugin("good")]));
    const holder: { events?: EventEmitter } = {};
    const spawn: SpawnWorker = (data) => {
      const worker = fakeWorker(data);
      holder.events?.emit("message", SHUTDOWN_MESSAGE);
      queueMicrotask(() => {
        worker.ready();
      });
      return worker.handle;
    };
    const { ports, armed } = fakePorts();
    const running = run(env(), { ...ports, spawn });
    holder.events = running.events;
    await running.done;
    await vi.waitFor(() => {
      expect(running.exit).toHaveBeenCalledWith(ExitCode.Clean);
    });
    expect(running.exit).toHaveBeenCalledTimes(1);
    expect(running.out()).toBe("");
    expect(running.err()).toContain("shutting down");
    expect(armed).toEqual([]);
    await (await occupy(port))();
  });

  it("exits 1 when a startup cancelled by a shutdown request could not clean up", async () => {
    const browser: ClosableBrowserDriver = {
      fetchPage: async () => Promise.reject(new Error("unused")),
      close: async () => Promise.reject(new Error("browser stuck")),
    };
    const running = run(env(), { ...fakePorts().ports, browser });
    running.events.emit("SIGTERM");
    await running.done;
    await vi.waitFor(() => {
      expect(running.exit).toHaveBeenCalledWith(ExitCode.Failed);
    });
  });
});
