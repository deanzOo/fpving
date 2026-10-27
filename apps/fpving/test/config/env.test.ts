import { describe, expect, it } from "vitest";
import { EnvErrorKind, LogLevel, parseEnv } from "../../src/config/env.ts";

const FAKE_KEY = "test-key-not-a-real-secret";
const valid = { PORT: "4321", DATA_DIR: ".data/main" };

describe("Environment config", () => {
  it("parses a minimal environment and defaults the log level to info", () => {
    expect(parseEnv(valid)).toEqual({
      ok: true,
      value: { PORT: 4321, DATA_DIR: ".data/main", LOG_LEVEL: LogLevel.Info },
    });
  });

  it("keeps an optional Anthropic key and an explicit log level", () => {
    const parsed = parseEnv({ ...valid, ANTHROPIC_API_KEY: FAKE_KEY, LOG_LEVEL: "debug" });
    expect(parsed).toEqual({
      ok: true,
      value: { PORT: 4321, DATA_DIR: ".data/main", ANTHROPIC_API_KEY: FAKE_KEY, LOG_LEVEL: LogLevel.Debug },
    });
  });

  it.each(["1024", "65535"])("accepts the boundary port %s", (PORT) => {
    expect(parseEnv({ ...valid, PORT }).ok).toBe(true);
  });

  it.each(["1023", "65536", "80", "abc", "", "4000.5", "-4000", "0x1000"])("rejects the port %j", (PORT) => {
    const parsed = parseEnv({ ...valid, PORT });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe(EnvErrorKind.Invalid);
      expect(parsed.error.issues.map((issue) => issue.variable)).toEqual(["PORT"]);
    }
  });

  it("rejects a missing port and a missing data dir, naming each variable", () => {
    const parsed = parseEnv({});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.issues.map((issue) => issue.variable).sort()).toEqual(["DATA_DIR", "PORT"]);
    }
  });

  it("rejects an empty data dir, an empty Anthropic key and an unknown log level", () => {
    const parsed = parseEnv({ PORT: "4321", DATA_DIR: "", ANTHROPIC_API_KEY: "", LOG_LEVEL: "loud" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.issues.map((issue) => issue.variable).sort()).toEqual([
        "ANTHROPIC_API_KEY",
        "DATA_DIR",
        "LOG_LEVEL",
      ]);
    }
  });

  it("treats an absent Anthropic key as not configured", () => {
    const parsed = parseEnv(valid);
    expect(parsed.ok && "ANTHROPIC_API_KEY" in parsed.value).toBe(false);
  });

  it("never puts the Anthropic key in an error message", () => {
    const parsed = parseEnv({ PORT: "nope", DATA_DIR: "", ANTHROPIC_API_KEY: FAKE_KEY, LOG_LEVEL: FAKE_KEY });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(JSON.stringify(parsed.error)).not.toContain(FAKE_KEY);
      expect(parsed.error.message).not.toContain(FAKE_KEY);
    }
  });

  it("summarises every problem in one readable message", () => {
    const parsed = parseEnv({ PORT: "80", DATA_DIR: "" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/^Invalid environment: PORT: .+; DATA_DIR: .+$/);
    }
  });
});
