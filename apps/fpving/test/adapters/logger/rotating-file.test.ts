import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRotatingFile } from "../../../src/adapters/logger/rotating-file.ts";

const MAX_BYTES = 10;
const FULL = "0123456789\n";
const OPEN_FILE = 0o644;
const OWNER_ONLY_FILE = 0o600;
const PERMISSIONS = 0o777;
const FAILED_OPENS = 2;

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

  it("drops a line when the file cannot be reopened, on every OS, and writes again once it can", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    let failOpens = 0;
    const open = (path: string): number => {
      if (failOpens > 0) {
        failOpens -= 1;
        throw new Error("EMFILE: too many open files");
      }
      return openSync(path, "a");
    };
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1, open });
    sink.write(FULL);
    failOpens = FAILED_OPENS;
    expect(() => {
      sink.write("lost\n");
      sink.write("lost too\n");
    }).not.toThrow();
    sink.write("back\n");
    sink.close();
    expect(readFileSync(file, "utf8")).toBe("back\n");
    expect(readFileSync(`${file}.1`, "utf8")).toBe(FULL);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("after a failed rotation retries only once another full file of bytes has been written", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1 });
    sink.write(FULL);
    blockRotation();
    sink.write("a\n");
    for (const line of ["b\n", "c\n", "d\n"]) {
      sink.write(line);
    }
    expect(readdirSync(join(dir, "logs")).toSorted()).toEqual(["fpving.log", "fpving.log.1"]);
    rmSync(`${file}.1`, { recursive: true });
    sink.write("e\n");
    sink.write("f\n");
    sink.close();
    expect(readFileSync(file, "utf8")).toBe("f\n");
    expect(readFileSync(`${file}.1`, "utf8")).toBe(`${FULL}a\nb\nc\nd\ne\n`);
  });

  it("recreates the log folder when it was deleted while the app runs", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    let failNext = false;
    const open = (path: string): number => {
      if (failNext) {
        failNext = false;
        throw new Error("EACCES: permission denied");
      }
      return openSync(path, "a");
    };
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1, open });
    sink.write(FULL);
    failNext = true;
    sink.write("lost\n");
    rmSync(join(dir, "logs"), { recursive: true });
    sink.write("again\n");
    sink.close();
    expect(readFileSync(file, "utf8")).toBe("again\n");
  });

  onPosix("makes the log file owner-only even when an earlier version created it open", () => {
    mkdirSync(join(dir, "logs"));
    writeFileSync(file, "", { mode: OPEN_FILE });
    chmodSync(file, OPEN_FILE);
    const sink = openRotatingFile({ file, maxBytes: MAX_BYTES, keptFiles: 1 });
    sink.close();
    expect(statSync(file).mode & PERMISSIONS).toBe(OWNER_ONLY_FILE);
  });
});
