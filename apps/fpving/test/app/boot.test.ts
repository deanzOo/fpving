import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate } from "../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../src/adapters/sqlite/repository.ts";
import { ExitCode, SHUTDOWN_MESSAGE } from "../../src/app/lifecycle.ts";
import { DB_FILE } from "../../src/app/start.ts";
import { HEALTH_PATH } from "../../src/server/health.ts";

const ENTRY = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const SOURCE_HOOKS = new URL("../support/source-hooks.ts", import.meta.url).href;
const BOOT_TIMEOUT_MS = 60_000;
const POLL_MS = 100;
const OK = 200;
const FAKE_KEY = "sk-ant-test-not-a-real-secret";
const isWindows = process.platform === "win32";

let dataDir = "";
let child: ChildProcess | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fpving-boot-"));
});

afterEach(() => {
  child?.kill();
  child = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

const freePort = async (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = z.object({ port: z.number() }).parse(probe.address());
      probe.close(() => {
        resolve(port);
      });
    });
  });

const withoutAnthropic = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("ANTHROPIC_")));

const seedFreshRates = async (): Promise<void> => {
  migrate(join(dataDir, DB_FILE));
  const { repository, close } = openSqliteRepository(join(dataDir, DB_FILE));
  const fetchedOn = new Date().toISOString().slice(0, "yyyy-mm-dd".length);
  await repository.fxRates.save({ base: "EUR", fetchedOn, ratesPerBase: { USD: 1 } });
  close();
};

const boot = (env: NodeJS.ProcessEnv): { process: ChildProcess; stderr: () => string } => {
  let stderr = "";
  const spawned = fork(ENTRY, [], {
    env,
    execArgv: ["--conditions=@fpving/source", "--import", SOURCE_HOOKS],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  spawned.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child = spawned;
  return { process: spawned, stderr: () => stderr };
};

const healthOf = async (port: number, spawned: ChildProcess): Promise<unknown> => {
  for (;;) {
    if (spawned.exitCode !== null) {
      throw new Error(`the app exited with ${String(spawned.exitCode)} before serving`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`);
      expect(response.status).toBe(OK);
      return await response.json();
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
};

const exitCode = async (spawned: ChildProcess): Promise<unknown> => (await once(spawned, "exit"))[0];

describe("App process", () => {
  const started = async () => {
    await seedFreshRates();
    const port = await freePort();
    const running = boot({ ...withoutAnthropic(), PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: "info" });
    expect(await healthOf(port, running.process)).toMatchObject({ ok: true, plugins: { loaded: 0, disabled: 0 } });
    return running;
  };

  it("serves health over real HTTP and exits cleanly on the IPC shutdown message", async () => {
    const running = await started();
    const exited = exitCode(running.process);
    running.process.send(SHUTDOWN_MESSAGE);
    expect(await exited).toBe(ExitCode.Clean);
  }, BOOT_TIMEOUT_MS);

  it.skipIf(isWindows)("exits cleanly on SIGTERM", async () => {
    const running = await started();
    const exited = exitCode(running.process);
    running.process.kill("SIGTERM");
    expect(await exited).toBe(ExitCode.Clean);
  }, BOOT_TIMEOUT_MS);

  it("exits non-zero with a clear message on a bad environment, never printing the key", async () => {
    const running = boot({ ...withoutAnthropic(), PORT: "nope", DATA_DIR: dataDir, ANTHROPIC_API_KEY: FAKE_KEY });
    expect(await exitCode(running.process)).toBe(ExitCode.Failed);
    expect(running.stderr()).toContain("PORT");
    expect(running.stderr()).not.toContain(FAKE_KEY);
  }, BOOT_TIMEOUT_MS);
});
