import type { Result } from "@fpving/plugin-sdk";
import type { AlertId } from "../ids.js";

/** An alert rendered for the user, ready to show as a desktop notification. */
export interface AlertNotification {
  /** The stored alert, so a click can open it. */
  readonly alertId: AlertId;
  /** One short line, such as the product name and alert kind. */
  readonly title: string;
  /** The detail, such as the old and new price. */
  readonly body: string;
}

/** The notification could not be shown; the alert stays stored either way. `detail` is for logs. */
export interface NotifyFailed {
  readonly kind: "notify_failed";
  readonly detail: string;
}

/** Shows alerts to the user. */
export interface Notifier {
  /** Shows one alert. Resolves to a `Result` and never rejects. */
  notify(notification: AlertNotification): Promise<Result<void, NotifyFailed>>;
}
