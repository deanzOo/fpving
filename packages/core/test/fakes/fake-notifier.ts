import { ok } from "../../src/index.ts";
import type { AlertNotification, Notifier, NotifyFailed, Result } from "../../src/index.ts";

/** A {@link Notifier} that records every notification in `sent` and answers `answer`. */
export const fakeNotifier = (
  answer: Result<void, NotifyFailed> = ok(undefined),
): Notifier & { sent: AlertNotification[] } => {
  const sent: AlertNotification[] = [];
  return {
    sent,
    notify: async (notification) => {
      sent.push(notification);
      return Promise.resolve(answer);
    },
  };
};
