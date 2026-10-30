import { closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
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
}

/** A synchronous line sink pino can write to. */
export interface RotatingFile {
  write(line: string): void;
  /** Closes the open file. Idempotent. */
  close(): void;
}

/**
 * Opens a log file that rotates by size: a line that would take the file past `maxBytes` first moves it to
 * `<file>.1`, shifting older ones up to `<file>.<keptFiles>` and dropping the oldest. A file never holds less than one
 * line. What an earlier run wrote counts towards the size. Folders are created owner-only and files are owner-only.
 *
 * @param options - The file, the size limit and how many rotated files to keep.
 * @returns The sink.
 */
export const openRotatingFile = (options: RotatingFileOptions): RotatingFile => {
  const { file, maxBytes, keptFiles } = options;
  mkdirSync(dirname(file), { recursive: true, mode: OWNER_ONLY_DIR });
  let fd: number | null = openSync(file, APPEND, OWNER_ONLY_FILE);
  let size = fstatSync(fd).size;
  const rotate = (open: number): number => {
    closeSync(open);
    for (let index = keptFiles - 1; index >= 1; index -= 1) {
      if (existsSync(`${file}.${String(index)}`)) {
        renameSync(`${file}.${String(index)}`, `${file}.${String(index + 1)}`);
      }
    }
    renameSync(file, `${file}.1`);
    size = 0;
    return openSync(file, APPEND, OWNER_ONLY_FILE);
  };
  return {
    write: (line) => {
      if (fd === null) {
        return;
      }
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) {
        fd = rotate(fd);
      }
      writeSync(fd, line);
      size += bytes;
    },
    close: () => {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
};
