import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LogLevel } from "../../../src/config/env.ts";
import { createPinoLogger, REDACTED } from "../../../src/adapters/logger/pino-logger.ts";

const SECRET = "sk-ant-live-not-a-real-secret";

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fpving-log-"));
  file = join(dir, "logs", "nested", "fpving.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (): Record<string, unknown>[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));

describe("Logging to a file", () => {
  it("writes one JSON line per event with the message and its fields, creating missing directories", () => {
    const logger = createPinoLogger({ level: LogLevel.Info, file });
    logger.info("scan finished", { listings: 3, plugin: "store", stale: false, note: null });
    expect(lines()).toEqual([
      expect.objectContaining({ msg: "scan finished", listings: 3, plugin: "store", stale: false, note: null }),
    ]);
  });

  it("labels each event with its level", () => {
    const logger = createPinoLogger({ level: LogLevel.Debug, file });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines().map((line) => line["level"])).toEqual(["debug", "info", "warn", "error"]);
  });

  it("drops events below the configured level", () => {
    const logger = createPinoLogger({ level: LogLevel.Warn, file });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines().map((line) => line["msg"])).toEqual(["w", "e"]);
  });

  it("writes nothing when the level is silent", () => {
    const logger = createPinoLogger({ level: LogLevel.Silent, file });
    logger.error("e");
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("does not add the process id or host name", () => {
    createPinoLogger({ level: LogLevel.Info, file }).info("x");
    expect(Object.keys(lines()[0] ?? {})).toEqual(expect.not.arrayContaining(["pid", "hostname"]));
  });
});

describe("Redacting secrets", () => {
  it.each([
    "apiKey",
    "api_key",
    "ANTHROPIC_API_KEY",
    "x-api-key",
    "X-Api-Key",
    "authorization",
    "Authorization",
    "cookie",
    "Cookie",
    "set-cookie",
    "Set-Cookie",
    "token",
    "accessToken",
    "refresh_token",
    "password",
    "clientSecret",
  ])("masks the %s field", (name) => {
    createPinoLogger({ level: LogLevel.Info, file }).error("request failed", { [name]: SECRET, status: 401 });
    expect(readFileSync(file, "utf8")).not.toContain(SECRET);
    expect(lines()[0]).toEqual(expect.objectContaining({ [name]: REDACTED, status: 401 }));
  });

  it("leaves other fields as they are", () => {
    createPinoLogger({ level: LogLevel.Info, file }).info("ok", { url: "https://example.com", count: 2 });
    expect(lines()[0]).toEqual(expect.objectContaining({ url: "https://example.com", count: 2 }));
  });
});
