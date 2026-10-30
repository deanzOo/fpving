import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRotatingFile } from "../../../src/adapters/logger/rotating-file.ts";

const MAX_BYTES = 10;
const FULL = "0123456789\n";

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fpving-rotate-"));
  file = join(dir, "logs", "fpving.log");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const blockRotation = (): void => {
  mkdirSync(join(`${file}.1`, "occupied"), { recursive: true });
};

describe("Rotating log file failures", () => {
  it("keeps logging to the current file when a rotation cannot rename it, never touching other descriptors", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1 });
    sink.write(FULL);
    blockRotation();
    expect(() => {
      sink.write("second\n");
    }).not.toThrow();
    const victimPath = join(dir, "victim.db");
    const victim = openSync(victimPath, "w");
    expect(() => {
      sink.write("third\n");
    }).not.toThrow();
    writeSync(victim, "victim-data\n");
    closeSync(victim);
    sink.close();
    expect(readFileSync(victimPath, "utf8")).toBe("victim-data\n");
    expect(readFileSync(file, "utf8")).toBe(`${FULL}second\nthird\n`);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("fpving log");
  });

  const onPosix = it.skipIf(process.platform === "win32");

  onPosix("drops a line it cannot write without throwing, reports once, and recovers once it can open the file", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1 });
    sink.write(FULL);
    rmSync(join(dir, "logs"), { recursive: true, force: true });
    writeFileSync(join(dir, "logs"), "a file where the folder was");
    expect(() => {
      sink.write("lost\n");
      sink.write("lost too\n");
    }).not.toThrow();
    expect(stderr).toHaveBeenCalledTimes(1);
    rmSync(join(dir, "logs"));
    mkdirSync(join(dir, "logs"));
    sink.write("back\n");
    sink.close();
    expect(readFileSync(file, "utf8")).toBe("back\n");
  });
});
