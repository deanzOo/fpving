import { ok } from "../../src/index.ts";
import type { DebugSink, PluginId } from "../../src/index.ts";

/** A {@link DebugSink} that records every saved page in `pages`. */
export const fakeDebugSink = (): DebugSink & { pages: { pluginId: PluginId; url: string; html: string }[] } => {
  const pages: { pluginId: PluginId; url: string; html: string }[] = [];
  return {
    pages,
    savePage: async (pluginId, url, html) => {
      pages.push({ pluginId, url, html });
      return Promise.resolve(ok(undefined));
    },
  };
};
