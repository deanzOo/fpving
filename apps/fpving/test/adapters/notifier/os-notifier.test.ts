import { alertIdSchema, PortErrorKind } from "@fpving/core";
import type { AlertNotification } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { callbackBackend, createOsNotifier, nodeNotifierBackend } from "../../../src/adapters/notifier/os-notifier.ts";
import type { NodeNotifierLike, NotifyBackend, OsNotification } from "../../../src/adapters/notifier/os-notifier.ts";

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
