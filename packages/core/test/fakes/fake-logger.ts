import type { Logger, LogFields } from "@fpving/plugin-sdk";

/** A {@link Logger} that records every warning in `warnings` and drops other levels. */
export const fakeLogger = (): Logger & { warnings: { message: string; fields: LogFields | undefined }[] } => {
  const warnings: { message: string; fields: LogFields | undefined }[] = [];
  const drop = (): void => undefined;
  return {
    warnings,
    debug: drop,
    info: drop,
    error: drop,
    warn: (message, fields) => {
      warnings.push({ message, fields });
    },
  };
};
