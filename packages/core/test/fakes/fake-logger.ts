import type { Logger, LogFields } from "@fpving/plugin-sdk";

interface Logged {
  message: string;
  fields: LogFields | undefined;
}

/** A {@link Logger} that records every warning in `warnings` and every error in `errors`, and drops other levels. */
export const fakeLogger = (): Logger & { warnings: Logged[]; errors: Logged[] } => {
  const warnings: Logged[] = [];
  const errors: Logged[] = [];
  const drop = (): void => undefined;
  return {
    warnings,
    errors,
    debug: drop,
    info: drop,
    error: (message, fields) => {
      errors.push({ message, fields });
    },
    warn: (message, fields) => {
      warnings.push({ message, fields });
    },
  };
};
