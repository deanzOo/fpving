import pino from "pino";
import type { Logger } from "@fpving/core";
import type { LogLevel } from "../../config/env.js";
import { openRotatingFile } from "./rotating-file.js";

const LOG_MAX_BYTES = 10_485_760;

const LOG_KEPT_FILES = 5;

/** What a masked field holds. */
export const REDACTED = "[redacted]";

const SECRET_FIELD = /key|token|secret|password|authorization|cookie/i;

const redact = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, SECRET_FIELD.test(name) ? REDACTED : value]));

/** Where and how much to log. */
export interface PinoLoggerOptions {
  /** The minimum level written, `LOG_LEVEL`. */
  readonly level: LogLevel;
  /** The log file; missing directories are created. */
  readonly file: string;
  /** The rotation size; 10 MiB by default. */
  readonly maxFileBytes?: number;
  /** How many rotated files to keep; five by default. */
  readonly keptFiles?: number;
}

/** A logger that owns its open file. */
export interface ClosableLogger extends Logger {
  /** Closes the log file; later events are dropped. Idempotent. */
  close(): void;
}

/**
 * Creates the core {@link Logger} on pino, writing JSON lines synchronously to a file that rotates by size, see
 * `openRotatingFile`. Pino's `redact` paths match whole keys
 * and do not take wildcards inside a name, so every field whose name contains `key`, `token`, `secret`,
 * `password`, `authorization` or `cookie`, in any letter case, is masked instead. That covers api keys, the
 * `authorization`, `x-api-key`, `cookie` and `set-cookie` headers and the likes of `accessToken`.
 *
 * @param options - The level and the file.
 * @returns The logger.
 */
export const createPinoLogger = (options: PinoLoggerOptions): ClosableLogger => {
  const destination = openRotatingFile({
    file: options.file,
    maxBytes: options.maxFileBytes ?? LOG_MAX_BYTES,
    keptFiles: options.keptFiles ?? LOG_KEPT_FILES,
  });
  const logger = pino(
    {
      level: options.level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }), log: redact },
    },
    destination,
  );
  return {
    debug: (message, fields) => {
      logger.debug(fields ?? {}, message);
    },
    info: (message, fields) => {
      logger.info(fields ?? {}, message);
    },
    warn: (message, fields) => {
      logger.warn(fields ?? {}, message);
    },
    error: (message, fields) => {
      logger.error(fields ?? {}, message);
    },
    close: () => {
      destination.close();
    },
  };
};
