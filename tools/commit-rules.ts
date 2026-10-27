export const COMMIT_TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "docs",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export const COMMIT_SCOPES = [
  "core",
  "plugin-sdk",
  "plugins",
  "matcher",
  "pricing",
  "alerts",
  "scheduler",
  "db",
  "ui",
  "api",
  "ci",
  "deps",
] as const;

export const SUBJECT_MAX = 72;

export const BODY_LINE_MAX = 100;
