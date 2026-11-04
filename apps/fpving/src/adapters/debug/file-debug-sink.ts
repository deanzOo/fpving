import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PortErrorKind, pluginIdSchema } from "@fpving/core";
import type { Clock, DebugSink, DebugWriteFailed } from "@fpving/core";
import type { Result } from "@fpving/plugin-sdk";
import { MAX_BODY_BYTES } from "../transport/fetch-http-client.js";

/** The largest page the sink saves, the HTTP client's body cap, in UTF-8 bytes; a larger one is refused. */
export const MAX_DEBUG_PAGE_BYTES = MAX_BODY_BYTES;

/** The most one plugin's saved pages may take up, a hundred megabytes; its oldest pages go first. */
export const MAX_DEBUG_FOLDER_BYTES = 104_857_600;

const PAGE_MAX_AGE_MS = 2_592_000_000;

/** Why the sink refused a page before touching the file system. */
export const DebugSinkRefusal = {
  InvalidPluginId: "the plugin id is not a valid plugin id",
  TooLarge: "the page is larger than the debug page cap",
} as const;

const DEBUG_DIR = "debug";
const HASH_PREFIX_LENGTH = 16;
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const PAGE_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{16}\.html$/u;

/** What {@link createFileDebugSink} needs. */
export interface FileDebugSinkOptions {
  /** The app's `DATA_DIR`; pages go under its `debug` folder. */
  readonly dataDir: string;
  /** Stamps each file name, and decides which pages are too old. */
  readonly clock: Clock;
  /** The size cap of one plugin's pages; defaults to {@link MAX_DEBUG_FOLDER_BYTES}. */
  readonly maxFolderBytes?: number;
}

/** A {@link DebugSink} that also checks, at run time, plugin ids that did not come through the type system. */
export interface FileDebugSink extends DebugSink {
  savePage(pluginId: string, url: string, html: string): ReturnType<DebugSink["savePage"]>;
}

const failed = (detail: string): Result<never, DebugWriteFailed> =>
  err({ kind: PortErrorKind.DebugWriteFailed, detail });

const stampOf = (time: Date): string => time.toISOString().replaceAll(/[:.]/gu, "-");

const fileName = (now: Date, url: string): string =>
  `${stampOf(now)}-${createHash("sha256").update(url).digest("hex").slice(0, HASH_PREFIX_LENGTH)}.html`;

const prune = async (dir: string, saved: string, now: Date, maxBytes: number): Promise<void> => {
  const sizeOf = async (name: string): Promise<number> => (await stat(join(dir, name))).size;
  const pages = (await readdir(dir)).filter((name) => PAGE_NAME.test(name) && name !== saved).sort();
  const oldestKept = stampOf(new Date(now.getTime() - PAGE_MAX_AGE_MS));
  const kept = await Promise.all(pages.filter((name) => name >= oldestKept)
    .map(async (name) => ({ name, size: await sizeOf(name) })));
  const doomed = pages.filter((name) => name < oldestKept);
  let total = kept.reduce((sum, { size }) => sum + size, await sizeOf(saved));
  for (const { name, size } of kept) {
    if (total <= maxBytes) {
      break;
    }
    doomed.push(name);
    total -= size;
  }
  await Promise.all(doomed.map(async (name) => rm(join(dir, name), { force: true })));
};

/**
 * Creates the core {@link DebugSink} on the file system. A page goes to
 * `DATA_DIR/debug/<pluginId>/<UTC time>-<first 16 hex of sha256(url)>.html`, so no URL text reaches the path, and the
 * folders are created owner-only. After each save it deletes that plugin's pages older than thirty days,
 * then its oldest until they fit {@link MAX_DEBUG_FOLDER_BYTES}, never the page just
 * saved; other files in the folder are left alone and not counted. A plugin id that fails the plugin id schema,
 * which would let a path escape the folder, and a page over {@link MAX_DEBUG_PAGE_BYTES} are refused. Every failure
 * is a `debug_write_failed` result.
 *
 * @param options - The data directory, the clock and, for tests, the size cap.
 * @returns The sink.
 */
export const createFileDebugSink = (options: FileDebugSinkOptions): FileDebugSink => ({
  savePage: async (pluginId, url, html) => {
    const id = pluginIdSchema.safeParse(pluginId);
    if (!id.success) {
      return failed(DebugSinkRefusal.InvalidPluginId);
    }
    if (Buffer.byteLength(html) > MAX_DEBUG_PAGE_BYTES) {
      return failed(DebugSinkRefusal.TooLarge);
    }
    const dir = join(options.dataDir, DEBUG_DIR, id.data);
    try {
      await mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR });
      const now = options.clock.now();
      const saved = fileName(now, url);
      await writeFile(join(dir, saved), html, { mode: OWNER_ONLY_FILE });
      await prune(dir, saved, now, options.maxFolderBytes ?? MAX_DEBUG_FOLDER_BYTES);
      return ok(undefined);
    } catch (error) {
      return failed(String(error));
    }
  },
});
