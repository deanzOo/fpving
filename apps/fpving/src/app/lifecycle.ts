import { inspect } from "node:util";
import type { Logger } from "@fpving/core";

/** How long a shutdown may take before the process exits non-zero anyway. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

/** The process exit codes. */
export const ExitCode = { Clean: 0, Failed: 1 } as const;

/** One of the {@link ExitCode} values. */
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** The IPC message that asks the app to shut down, for supervisors where signals cannot be sent, such as Windows. */
export const SHUTDOWN_MESSAGE = "shutdown";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** One named part of a shutdown. */
export interface ShutdownStep {
  readonly name: string;
  readonly run: () => Promise<void> | void;
}

/**
 * Builds an idempotent shutdown: the first call runs the steps one after another, and every call resolves to that
 * run's result. A step that throws is logged and the later steps still run.
 *
 * @param steps - The steps in the order to run them.
 * @param logger - Where failing steps are logged.
 * @returns The shutdown, resolving true when every step succeeded.
 */
export const sequenceShutdown = (steps: readonly ShutdownStep[], logger: Logger): (() => Promise<boolean>) => {
  let running: Promise<boolean> | null = null;
  const runAll = async (): Promise<boolean> => {
    let clean = true;
    for (const step of steps) {
      try {
        await step.run();
      } catch (error) {
        clean = false;
        logger.error("shutdown step failed", { step: step.name, detail: inspect(error) });
      }
    }
    return clean;
  };
  return async () => (running ??= runAll());
};

/**
 * Waits for a shutdown, but no longer than the deadline.
 *
 * @param work - The running shutdown.
 * @param deadlineMs - How long to wait.
 * @param logger - Where a missed deadline is logged.
 * @returns The shutdown's result, or false when the deadline passed first.
 */
export const withinDeadline = async (work: Promise<boolean>, deadlineMs: number, logger: Logger): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      logger.error("shutdown missed its deadline", { deadlineMs });
      resolve(false);
    }, deadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

interface ShutdownSource {
  on(event: (typeof SHUTDOWN_SIGNALS)[number], listener: () => void): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

/** What {@link handleShutdown} needs. */
export interface ShutdownHandling {
  /** Where requests come from: `process`, or an emitter in tests. */
  readonly source: ShutdownSource;
  readonly shutdown: () => Promise<boolean>;
  readonly logger: Logger;
  /** Ends the process, normally `process.exit`. */
  readonly exit: (code: ExitCode) => void;
  /** Defaults to {@link SHUTDOWN_DEADLINE_MS}. */
  readonly deadlineMs?: number;
}

/**
 * Shuts down on SIGINT, SIGTERM or the {@link SHUTDOWN_MESSAGE} IPC message, once, then exits: cleanly when every
 * step succeeded within the deadline, non-zero when one failed or the deadline passed first. Later requests are
 * ignored.
 *
 * @param handling - The request source, the shutdown, the logger and the exit.
 */
export const handleShutdown = (handling: ShutdownHandling): void => {
  const { source, shutdown, logger, exit } = handling;
  const deadlineMs = handling.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let requested = false;
  const request = (): void => {
    if (requested) {
      return;
    }
    requested = true;
    logger.info("shutting down");
    void withinDeadline(shutdown(), deadlineMs, logger).then((clean) => {
      exit(clean ? ExitCode.Clean : ExitCode.Failed);
    });
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    source.on(signal, request);
  }
  source.on("message", (message) => {
    if (message === SHUTDOWN_MESSAGE) {
      request();
    }
  });
};
