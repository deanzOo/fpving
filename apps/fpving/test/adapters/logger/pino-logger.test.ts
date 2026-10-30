import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("Rotating the log file", () => {
  const MAX_BYTES = 200;
  const KEPT = 2;
  const LINE = "x".repeat(MAX_BYTES / KEPT / KEPT);
  const rotated = (index: number): string => `${file}.${String(index)}`;

  it("moves a full file aside and starts a new one, keeping only the newest rotated files", () => {
    const logger = createPinoLogger({ level: LogLevel.Info, file, maxFileBytes: MAX_BYTES, keptFiles: KEPT });
    for (let index = 0; index < MAX_BYTES / KEPT; index += 1) {
      logger.info(LINE, { index });
    }
    logger.close();
    const sizes = [file, rotated(1), rotated(KEPT)].map((path) => statSync(path).size);
    expect(sizes.every((size) => size > 0 && size <= MAX_BYTES)).toBe(true);
    expect(existsSync(rotated(KEPT + 1))).toBe(false);
    expect(lines().at(-1)).toEqual(expect.objectContaining({ index: MAX_BYTES / KEPT - 1 }));
  });

  it("drops events logged after it is closed, and closing it twice does nothing more", () => {
    const logger = createPinoLogger({ level: LogLevel.Info, file });
    logger.info("before");
    logger.close();
    logger.close();
    logger.info("after");
    expect(lines().map((line) => line["msg"])).toEqual(["before"]);
  });

  it("counts what an earlier run left in the file before rotating", () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${"y".repeat(MAX_BYTES)}\n`);
    const logger = createPinoLogger({ level: LogLevel.Info, file, maxFileBytes: MAX_BYTES, keptFiles: KEPT });
    logger.info("after restart");
    logger.close();
    expect(readFileSync(rotated(1), "utf8")).toContain("y");
    expect(lines().map((line) => line["msg"])).toEqual(["after restart"]);
  });

  it.skipIf(process.platform === "win32")("creates the log folder and files readable by the owner only", () => {
    const logger = createPinoLogger({ level: LogLevel.Info, file, maxFileBytes: MAX_BYTES, keptFiles: KEPT });
    logger.info(LINE);
    logger.info(LINE);
    logger.info(LINE);
    logger.close();
    const OWNER_ONLY_DIR = 0o700;
    const OWNER_ONLY_FILE = 0o600;
    const PERMISSIONS = 0o777;
    expect(statSync(dirname(file)).mode & PERMISSIONS).toBe(OWNER_ONLY_DIR);
    expect(statSync(file).mode & PERMISSIONS).toBe(OWNER_ONLY_FILE);
    expect(statSync(rotated(1)).mode & PERMISSIONS).toBe(OWNER_ONLY_FILE);
  });
});
