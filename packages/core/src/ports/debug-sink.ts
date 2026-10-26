import type { Result } from "@fpving/plugin-sdk";

/** The page could not be saved; `detail` is for logs. */
export interface DebugWriteFailed {
  readonly kind: "debug_write_failed";
  readonly detail: string;
}

/** Keeps raw pages a plugin could not parse, so each can become a test fixture. */
export interface DebugSink {
  /** Saves the page a `parse_failed` fetch of `url` returned. Resolves to a `Result` and never rejects. */
  savePage(pluginId: string, url: string, html: string): Promise<Result<void, DebugWriteFailed>>;
}
