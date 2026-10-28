import { execFile } from "node:child_process";
import { err, ok, PortErrorKind } from "@fpving/core";
import type { AlertNotification, Notifier, NotifyFailed, Result } from "@fpving/core";
import nodeNotifier from "node-notifier";

/** What a backend shows. */
export interface OsNotification {
  readonly title: string;
  readonly message: string;
}

/** Shows one OS notification and rejects when it could not be shown. */
export type NotifyBackend = (notification: OsNotification) => Promise<void>;

/** The part of `node-notifier` the backend uses. */
export interface NodeNotifierLike {
  notify(notification: OsNotification, callback: (error: Error | string | null | undefined) => void): unknown;
}

/**
 * Adapts a callback-style notifier, such as `node-notifier`, to a {@link NotifyBackend}.
 *
 * @param notifier - The callback-style notifier.
 * @returns A backend that rejects with the error the notifier reports. `node-notifier` reports success as an empty
 * string, `undefined` or `null`, so only a truthy error argument is a failure; a string is the command's stderr.
 */
export const callbackBackend = (notifier: NodeNotifierLike): NotifyBackend => {
  return async (notification) =>
    new Promise((resolve, reject) => {
      notifier.notify(notification, (error) => {
        if (!error) {
          resolve();
        } else {
          reject(typeof error === "string" ? new Error(error) : error);
        }
      });
    });
};

/** Shows notifications through `node-notifier`: Windows toasts or notify-send. */
export const nodeNotifierBackend: NotifyBackend = callbackBackend(nodeNotifier);

/** The fixed AppleScript the macOS backend runs; the title and message arrive only as its arguments. */
export const OSASCRIPT_NOTIFY_SCRIPT
  = "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run";

/** The part of `child_process.execFile` the macOS backend uses. */
export type ExecFileFn = (file: string, args: readonly string[], callback: (error: Error | null) => void) => unknown;

/**
 * Shows notifications on macOS with the built-in `osascript`, which runs natively on Apple Silicon. The title and
 * message are passed after `--` as script arguments, never written into the script, so they cannot inject AppleScript.
 *
 * @param exec - Runs the command, normally `execFile`.
 * @returns A backend that rejects when `osascript` fails.
 */
export const osascriptBackend = (exec: ExecFileFn): NotifyBackend => async (notification) =>
  new Promise((resolve, reject) => {
    exec("osascript", ["-e", OSASCRIPT_NOTIFY_SCRIPT, "--", notification.title, notification.message], (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

/**
 * Picks the backend for a platform: {@link osascriptBackend} on macOS, where `node-notifier`'s bundled
 * terminal-notifier is x86_64-only, and {@link nodeNotifierBackend} elsewhere.
 *
 * @param platform - Normally `process.platform`.
 * @param exec - Runs `osascript` on macOS; `execFile` by default.
 * @returns The backend.
 */
export const notifyBackendFor = (platform: NodeJS.Platform, exec: ExecFileFn = execFile): NotifyBackend =>
  platform === "darwin" ? osascriptBackend(exec) : nodeNotifierBackend;

/**
 * Creates the core {@link Notifier} on a backend. A failed backend is a `notify_failed` result, never a throw.
 *
 * @param backend - Shows the notification, normally `notifyBackendFor(process.platform)`.
 * @returns The notifier.
 */
export const createOsNotifier = (backend: NotifyBackend): Notifier => ({
  notify: async (notification: AlertNotification): Promise<Result<void, NotifyFailed>> => {
    try {
      await backend({ title: notification.title, message: notification.body });
      return ok(undefined);
    } catch (error) {
      return err({ kind: PortErrorKind.NotifyFailed, detail: String(error) });
    }
  },
});
