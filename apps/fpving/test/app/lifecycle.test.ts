import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExitCode,
  handleShutdown,
  SHUTDOWN_DEADLINE_MS,
  SHUTDOWN_MESSAGE,
  sequenceShutdown,
} from "../../src/app/lifecycle.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const never = async (): Promise<boolean> => new Promise(() => undefined);

afterEach(() => {
  vi.useRealTimers();
});

describe("Shutdown sequence", () => {
  it("runs every step once, in order, however often it is asked", async () => {
    const ran: string[] = [];
    const step = (name: string) => ({ name, run: async () => Promise.resolve(void ran.push(name)) });
    const shutdown = sequenceShutdown([step("scheduler"), step("server"), step("database")], recordingLogger());
    const results = await Promise.all([shutdown(), shutdown()]);
    expect(await shutdown()).toBe(true);
    expect(results).toEqual([true, true]);
    expect(ran).toEqual(["scheduler", "server", "database"]);
  });

  it("logs a failing step, still runs the rest, and reports the failure", async () => {
    const logger = recordingLogger();
    const after = vi.fn();
    const shutdown = sequenceShutdown(
      [{ name: "server", run: () => { throw new Error("socket stuck"); } }, { name: "database", run: after }],
      logger,
    );
    expect(await shutdown()).toBe(false);
    expect(after).toHaveBeenCalledTimes(1);
    expect(logger.events.map(({ level, message, fields }) => [level, message, fields?.["step"]])).toEqual([
      ["error", "shutdown step failed", "server"],
    ]);
    expect(String(logger.events[0]?.fields?.["detail"])).toContain("socket stuck");
  });
});

describe("Shutdown on request", () => {
  const setUp = (shutdown: () => Promise<boolean>) => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const logger = recordingLogger();
    handleShutdown({ source, shutdown, logger, exit });
    return { source, exit, logger };
  };

  it.each(["SIGINT", "SIGTERM"])("shuts down once on %s and exits cleanly", async (signal) => {
    const shutdown = vi.fn(async () => Promise.resolve(true));
    const { source, exit } = setUp(shutdown);
    source.emit(signal);
    source.emit(signal);
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(ExitCode.Clean);
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("shuts down on the IPC shutdown message and ignores other messages", async () => {
    const shutdown = vi.fn(async () => Promise.resolve(true));
    const { source, exit } = setUp(shutdown);
    source.emit("message", "hello");
    expect(shutdown).not.toHaveBeenCalled();
    source.emit("message", SHUTDOWN_MESSAGE);
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(ExitCode.Clean);
    });
  });

  it("exits non-zero when a step failed", async () => {
    const { source, exit } = setUp(async () => Promise.resolve(false));
    source.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(ExitCode.Failed);
    });
  });

  it("exits non-zero once the deadline passes without the shutdown finishing", async () => {
    vi.useFakeTimers();
    const { source, exit, logger } = setUp(never);
    source.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(ExitCode.Failed);
    expect(logger.events.map(({ message }) => message)).toEqual(["shutting down", "shutdown missed its deadline"]);
  });

  it("clears its deadline once the shutdown finishes", async () => {
    vi.useFakeTimers();
    const { source, exit } = setUp(async () => Promise.resolve(true));
    source.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(ExitCode.Clean);
    expect(vi.getTimerCount()).toBe(0);
  });
});
