import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PortErrorKind, pluginIdSchema } from "@fpving/core";
import type { Clock, DebugSink, DebugWriteFailed } from "@fpving/core";
import type { Result } from "@fpving/plugin-sdk";

/** The largest page the sink saves, five megabytes of UTF-8; a larger one is refused, not truncated. */
export const MAX_DEBUG_PAGE_BYTES = 5_242_880;

/** Why the sink refused a page before touching the file system. */
export const DebugSinkRefusal = {
  InvalidPluginId: "the plugin id is not a valid plugin id",
  TooLarge: "the page is larger than the debug page cap",
} as const;

const DEBUG_DIR = "debug";
const HASH_PREFIX_LENGTH = 16;
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;

/** What {@link createFileDebugSink} needs. */
export interface FileDebugSinkOptions {
  /** The app's `DATA_DIR`; pages go under its `debug` folder. */
  readonly dataDir: string;
  /** Stamps each file name. */
  readonly clock: Clock;
}

/** A {@link DebugSink} that also checks, at run time, plugin ids that did not come through the type system. */
export interface FileDebugSink extends DebugSink {
  savePage(pluginId: string, url: string, html: string): ReturnType<DebugSink["savePage"]>;
}

const failed = (detail: string): Result<never, DebugWriteFailed> =>
  err({ kind: PortErrorKind.DebugWriteFailed, detail });

const fileName = (now: Date, url: string): string => {
  const stamp = now.toISOString().replaceAll(/[:.]/gu, "-");
  return `${stamp}-${createHash("sha256").update(url).digest("hex").slice(0, HASH_PREFIX_LENGTH)}.html`;
};

/**
 * Creates the core {@link DebugSink} on the file system. A page goes to
 * `DATA_DIR/debug/<pluginId>/<UTC time>-<first 16 hex of sha256(url)>.html`, so no URL text reaches the path, and the
 * folders are created owner-only. A plugin id that fails the plugin id schema, which would let a path escape the
 * folder, and a page over {@link MAX_DEBUG_PAGE_BYTES} are refused. Every failure is a `debug_write_failed` result.
 *
 * @param options - The data directory and the clock.
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
      await writeFile(join(dir, fileName(options.clock.now(), url)), html, { mode: OWNER_ONLY_FILE });
      return ok(undefined);
    } catch (error) {
      return failed(String(error));
    }
  },
});
