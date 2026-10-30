import type { LogFields, Logger } from "@fpving/plugin-sdk";

/** One event a {@link recordingLogger} received. */
export interface LoggedEvent {
  readonly level: keyof Logger;
  readonly message: string;
  readonly fields: LogFields | undefined;
}

/** A {@link Logger} that keeps every event in `events`. */
export const recordingLogger = (): Logger & { readonly events: LoggedEvent[] } => {
  const events: LoggedEvent[] = [];
  const at = (level: keyof Logger) => (message: string, fields?: LogFields): void => {
    events.push({ level, message, fields });
  };
  return { events, debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
};
