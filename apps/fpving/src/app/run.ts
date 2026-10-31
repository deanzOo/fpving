import type { Logger } from "@fpving/core";
import { ExitCode, handleShutdown } from "./lifecycle.js";
import type { ShutdownSource } from "./lifecycle.js";
import { startApp, StartupErrorKind } from "./start.js";
import type { AppPorts } from "./start.js";

/** What {@link runApp} needs: the process, or fakes in tests. */
export interface RunOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly overrides: Partial<AppPorts>;
  readonly events: ShutdownSource;
  readonly exit: (code: ExitCode) => void;
  /** Writes to stdout. */
  readonly out: (text: string) => void;
  /** Writes to stderr. */
  readonly err: (text: string) => void;
}

const terminalLogger = (err: (text: string) => void): Logger => {
  const line = (message: string): void => {
    err(`fpving: ${message}\n`);
  };
  return { debug: line, info: line, warn: line, error: line };
};

/**
 * Runs the app as a process: listens for SIGINT, SIGTERM and the IPC shutdown message before startup begins, so a
 * request while starting cancels the startup and cleans up, and one after it shuts the app down; either way the
 * process then exits under the shutdown deadline. Prints the address once listening, or one line and exits 1 when
 * the app cannot start.
 *
 * @param options - The environment, the port overrides, the request source, the exit and the output streams.
 */
export const runApp = async (options: RunOptions): Promise<void> => {
  const { events, exit, out, err } = options;
  const cancel = new AbortController();
  const startup = startApp(options.env, options.overrides, cancel.signal);
  handleShutdown({
    source: events,
    logger: terminalLogger(err),
    exit,
    shutdown: async () => {
      cancel.abort();
      const started = await startup;
      if (started.ok) {
        return started.value.shutdown();
      }
      return started.error.kind === StartupErrorKind.Cancelled && started.error.clean;
    },
  });
  const started = await startup;
  if (started.ok) {
    out(`fpving listening on ${started.value.address}\n`);
  } else if (started.error.kind !== StartupErrorKind.Cancelled) {
    err(`fpving did not start: ${started.error.message}\n`);
    exit(ExitCode.Failed);
  }
};
