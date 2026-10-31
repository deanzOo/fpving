import { closeSync, existsSync, fchmodSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const APPEND = "a";

/** Where to write and when to rotate. */
export interface RotatingFileOptions {
  /** The log file; missing directories are created. */
  readonly file: string;
  /** The size a file may reach before the next line goes to a fresh one. */
  readonly maxBytes: number;
  /** How many rotated files, `<file>.1` newest, are kept. */
  readonly keptFiles: number;
  /** Opens the file for appending; `openSync` by default, a failing fake in tests. */
  readonly open?: (path: string) => number;
}

const appendOwnerOnly = (path: string): number => openSync(path, APPEND, OWNER_ONLY_FILE);

/** A synchronous line sink pino can write to. */
export interface RotatingFile {
  write(line: string): void;
  /** Closes the open file. Idempotent. */
  close(): void;
}

/**
 * Opens a log file that rotates by size: a line that would take the file past `maxBytes` first moves it to
 * `<file>.1`, shifting older ones up to `<file>.<keptFiles>` and dropping the oldest. A file never holds less than one
 * line. What an earlier run wrote counts towards the size. The folder is created owner-only, again if it was deleted,
 * and the file is made owner-only on every open. A write never throws, because logging must not break its caller:
 * when a rotation cannot rename, the file is reopened and keeps growing, and rotation is tried again only after
 * another `maxBytes` were written, so a stuck rename does not shred the rotated history; when the file cannot be
 * opened, the line is dropped and the next write tries again. The first such failure is reported once on stderr.
 *
 * @param options - The file, the size limit, how many rotated files to keep and, for tests, the open function.
 * @returns The sink.
 */
export const openRotatingFile = (options: RotatingFileOptions): RotatingFile => {
  const { file, maxBytes, keptFiles } = options;
  const open = options.open ?? appendOwnerOnly;
  let fd: number | null = null;
  let size = 0;
  let rotateAt = maxBytes;
  let closed = false;
  let reported = false;
  const reopen = (): number => {
    mkdirSync(dirname(file), { recursive: true, mode: OWNER_ONLY_DIR });
    const opened = open(file);
    fd = opened;
    fchmodSync(opened, OWNER_ONLY_FILE);
    size = fstatSync(opened).size;
    return opened;
  };
  const report = (error: unknown): void => {
    if (!reported) {
      reported = true;
      process.stderr.write(`fpving log ${file} failed, lines may be lost: ${String(error)}\n`);
    }
  };
  const rotate = (current: number): number => {
    fd = null;
    closeSync(current);
    let renamed = true;
    try {
      for (let index = keptFiles - 1; index >= 1; index -= 1) {
        if (existsSync(`${file}.${String(index)}`)) {
          renameSync(`${file}.${String(index)}`, `${file}.${String(index + 1)}`);
        }
      }
      renameSync(file, `${file}.1`);
    } catch (error) {
      renamed = false;
      report(error);
    }
    const reopened = reopen();
    rotateAt = renamed ? maxBytes : size + maxBytes;
    return reopened;
  };
  reopen();
  return {
    write: (line) => {
      if (closed) {
        return;
      }
      const bytes = Buffer.byteLength(line);
      try {
        let current = fd ?? reopen();
        if (size > 0 && size + bytes > rotateAt) {
          current = rotate(current);
        }
        writeSync(current, line);
        size += bytes;
      } catch (error) {
        report(error);
      }
    },
    close: () => {
      closed = true;
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
};
