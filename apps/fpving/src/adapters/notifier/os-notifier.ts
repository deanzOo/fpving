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

/** Shows notifications through `node-notifier`: Notification Center, Windows toasts or notify-send. */
export const nodeNotifierBackend: NotifyBackend = callbackBackend(nodeNotifier);

/**
 * Creates the core {@link Notifier} on a backend. A failed backend is a `notify_failed` result, never a throw.
 *
 * @param backend - Shows the notification, normally {@link nodeNotifierBackend}.
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
