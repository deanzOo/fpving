/**
 * Why a port call failed, for the ports whose only failure is that they could not do the job. `rates_unavailable`:
 * the exchange rate source could not be reached or answered something unusable. `notify_failed`: the notification
 * could not be shown. `debug_write_failed`: the debug page could not be saved.
 */
export const PortErrorKind = {
  RatesUnavailable: "rates_unavailable",
  NotifyFailed: "notify_failed",
  DebugWriteFailed: "debug_write_failed",
} as const;

/** One of the {@link PortErrorKind} values. */
export type PortErrorKind = (typeof PortErrorKind)[keyof typeof PortErrorKind];
