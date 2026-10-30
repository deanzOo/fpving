import { alertIdSchema, PortErrorKind } from "@fpving/core";
import type { AlertNotification } from "@fpving/core";
import { describe, expect, it } from "vitest";
import {
  callbackBackend,
  createOsNotifier,
  nodeNotifierBackend,
  notifyBackendFor,
  OSASCRIPT_NOTIFY_SCRIPT,
  osascriptBackend,
} from "../../../src/adapters/notifier/os-notifier.ts";
import type {
  ExecFileFn,
  NodeNotifierLike,
  NotifyBackend,
  OsNotification,
} from "../../../src/adapters/notifier/os-notifier.ts";

const ALERT: AlertNotification = {
  alertId: alertIdSchema.parse("alert-1"),
  title: "Price drop: T-Motor F60",
  body: "Now 48.00 USD, was 55.00 USD",
};

describe("Showing alerts as OS notifications", () => {
  it("passes the alert title and body to the backend", async () => {
    const shown: OsNotification[] = [];
    const backend: NotifyBackend = (notification) => {
      shown.push(notification);
      return Promise.resolve();
    };
    const result = await createOsNotifier(backend).notify(ALERT);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(shown).toEqual([{ title: ALERT.title, message: ALERT.body }]);
  });

  it("reports a backend that rejects as notify failed", async () => {
    const backend: NotifyBackend = () => Promise.reject(new Error("notify-send not found"));
    const result = await createOsNotifier(backend).notify(ALERT);
    expect(result).toEqual({
      ok: false,
      error: { kind: PortErrorKind.NotifyFailed, detail: "Error: notify-send not found" },
    });
  });

  it("reports a backend that throws synchronously as notify failed", async () => {
    const backend: NotifyBackend = () => {
      throw new TypeError("bad platform");
    };
    const result = await createOsNotifier(backend).notify(ALERT);
    expect(result).toEqual({
      ok: false,
      error: { kind: PortErrorKind.NotifyFailed, detail: "TypeError: bad platform" },
    });
  });
});

describe("The callback style notifier backend", () => {
  const notifierCalling = (
    error: Error | string | null | undefined,
  ): { fake: NodeNotifierLike; received: OsNotification[] } => {
    const received: OsNotification[] = [];
    const fake: NodeNotifierLike = {
      notify: (notification, callback) => {
        received.push(notification);
        callback(error);
      },
    };
    return { fake, received };
  };

  it("resolves when the callback reports no error", async () => {
    const { fake, received } = notifierCalling(null);
    await expect(callbackBackend(fake)({ title: "t", message: "m" })).resolves.toBeUndefined();
    expect(received).toEqual([{ title: "t", message: "m" }]);
  });

  it.each([[""], [undefined], [null]])("resolves when the callback reports the falsy error %j", async (error) => {
    const { fake } = notifierCalling(error);
    await expect(callbackBackend(fake)({ title: "t", message: "m" })).resolves.toBeUndefined();
  });

  it("rejects with an error built from a stderr string", async () => {
    const { fake } = notifierCalling("some stderr");
    await expect(callbackBackend(fake)({ title: "t", message: "m" })).rejects.toThrow("some stderr");
  });

  it("maps a stderr string to notify failed through the notifier", async () => {
    const { fake } = notifierCalling("some stderr");
    const result = await createOsNotifier(callbackBackend(fake)).notify(ALERT);
    expect(result).toEqual({ ok: false, error: { kind: PortErrorKind.NotifyFailed, detail: "Error: some stderr" } });
  });

  it("rejects with the error the callback reports", async () => {
    const { fake } = notifierCalling(new Error("no daemon"));
    await expect(callbackBackend(fake)({ title: "t", message: "m" })).rejects.toThrow("no daemon");
  });

  it("is wired to the real node-notifier by default", () => {
    expect(nodeNotifierBackend).toBeTypeOf("function");
  });
});

describe("The macOS notifier backend", () => {
  const UNTRUSTED = [
    "plain",
    "say \"hi\"",
    "back\\slash",
    "\" & do shell script \"touch /tmp/pwned\" & \"",
    "-e",
    "--",
  ];

  const recordingExec = (error: Error | null) => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const exec: ExecFileFn = (file, args, callback) => {
      calls.push({ file, args });
      callback(error);
    };
    return { calls, exec };
  };

  it.each(UNTRUSTED)("passes %j to osascript only as an argument, never inside the script", async (text) => {
    const { calls, exec } = recordingExec(null);
    await osascriptBackend(exec)({ title: text, message: `${text} body` });
    expect(calls).toEqual([
      { file: "osascript", args: ["-e", OSASCRIPT_NOTIFY_SCRIPT, "--", text, `${text} body`] },
    ]);
  });

  it("uses a fixed script that reads the title and message from its arguments", () => {
    expect(OSASCRIPT_NOTIFY_SCRIPT).toBe(
      "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run",
    );
  });

  it("maps a failed osascript to notify failed", async () => {
    const { exec } = recordingExec(new Error("osascript: execution error"));
    const result = await createOsNotifier(osascriptBackend(exec)).notify(ALERT);
    expect(result).toEqual({
      ok: false,
      error: { kind: PortErrorKind.NotifyFailed, detail: "Error: osascript: execution error" },
    });
  });
});

describe("Choosing the notifier backend for the platform", () => {
  it("uses osascript on macOS, not node-notifier", async () => {
    const files: string[] = [];
    const exec: ExecFileFn = (file, _args, callback) => {
      files.push(file);
      callback(null);
    };
    await notifyBackendFor("darwin", exec)({ title: "t", message: "m" });
    expect(files).toEqual(["osascript"]);
  });

  it("builds a backend other than node-notifier on macOS when no exec is given", () => {
    expect(notifyBackendFor("darwin")).not.toBe(nodeNotifierBackend);
  });

  it.each(["linux", "win32"] as const)("uses node-notifier on %s", (platform) => {
    expect(notifyBackendFor(platform)).toBe(nodeNotifierBackend);
  });
});
