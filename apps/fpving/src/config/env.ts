import { z } from "zod";
import { err, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";

const MIN_PORT = 1024;
const MAX_PORT = 65_535;

export const LogLevel = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
  Silent: "silent",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const EnvErrorKind = { Invalid: "invalid_env" } as const;

const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.int().min(MIN_PORT, `must be >= ${String(MIN_PORT)}`).max(MAX_PORT, `must be <= ${String(MAX_PORT)}`)),
  DATA_DIR: z.string().min(1, "must not be empty"),
  ANTHROPIC_API_KEY: z.string().min(1, "must not be empty when set").optional(),
  LOG_LEVEL: z.enum(LogLevel).default(LogLevel.Info),
});

export type Env = z.infer<typeof envSchema>;

interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

export interface EnvError {
  readonly kind: typeof EnvErrorKind.Invalid;
  readonly issues: readonly EnvIssue[];
  readonly message: string;
}

/** Parses a `process.env`-shaped record. Error text names variables and rules, never their values. */
export const parseEnv = (source: Readonly<Record<string, string | undefined>>): Result<Env, EnvError> => {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const issues = parsed.error.issues.map((issue) => ({ variable: issue.path.join("."), message: issue.message }));
  const summary = issues.map((issue) => `${issue.variable}: ${issue.message}`).join("; ");
  return err({ kind: EnvErrorKind.Invalid, issues, message: `Invalid environment: ${summary}` });
};
