/** Why a scan on demand did nothing. `stopped`: the schedule was stopped, so no scan starts. */
export const SchedulerErrorKind = { Stopped: "stopped" } as const;

/** One of the {@link SchedulerErrorKind} values. */
export type SchedulerErrorKind = (typeof SchedulerErrorKind)[keyof typeof SchedulerErrorKind];
