import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { err, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind } from "./status.js";
import type { PluginIssue } from "./status.js";

/** The plugin list's file name inside `DATA_DIR`. */
export const PLUGINS_FILE = "plugins.json";

/** The longest npm package name npm accepts. */
export const MAX_NPM_NAME_LENGTH = 214;
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const MISSING_FILE = "ENOENT";
const NPM_NAME_RULE = "must be an npm package name";

/** Why {@link readTextFile} refused a path that exists but is not a regular file, such as a folder or a pipe. */
export const NOT_A_FILE = "not a regular file";

const pathEntrySchema = z.strictObject({
  path: z.string().refine(isAbsolute, "must be an absolute path").transform((path) => resolve(path)),
});

const packageEntrySchema = z.strictObject({
  package: z.string().max(MAX_NPM_NAME_LENGTH, NPM_NAME_RULE).regex(NPM_NAME, NPM_NAME_RULE),
});

type PluginEntry = z.infer<typeof pathEntrySchema> | z.infer<typeof packageEntrySchema>;

interface RejectedEntry {
  readonly index: number;
  readonly issue: PluginIssue;
}

export interface PluginsConfig {
  readonly entries: readonly PluginEntry[];
  readonly rejected: readonly RejectedEntry[];
}

/** Reads a UTF-8 file: `null` when it does not exist, an error message when it cannot be read. */
export type ReadTextFile = (path: string) => Promise<Result<string | null, string>>;

const configInvalid = (detail: string): PluginIssue => ({ kind: PluginIssueKind.ConfigInvalid, detail });

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map(({ path, message }) => (path.length === 0 ? message : `${path.join(".")}: ${message}`))
    .join("; ");

const parseEntry = (raw: unknown): Result<PluginEntry, string> => {
  const schema = typeof raw === "object" && raw !== null && "path" in raw ? pathEntrySchema : packageEntrySchema;
  const parsed = schema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(describeIssues(parsed.error));
};

const entryKey = (entry: PluginEntry): string => ("path" in entry ? `path:${entry.path}` : `package:${entry.package}`);

const parseJson = (text: string): Result<unknown, string> => {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch (error) {
    return err(String(error));
  }
};

/**
 * Parses the text of `plugins.json`: a JSON array of `{ "path": "<absolute folder>" }` or
 * `{ "package": "<npm name>" }` entries. Each entry is checked on its own, so an invalid or duplicate one is rejected
 * with a reason and the rest still load. Pure.
 *
 * @param text - The file's text, or `null` when the file does not exist, which means no plugins.
 * @returns The valid entries and the rejected ones, or `config_invalid` when the text is not a JSON array.
 */
export const parsePluginsConfig = (text: string | null): Result<PluginsConfig, PluginIssue> => {
  if (text === null) {
    return ok({ entries: [], rejected: [] });
  }
  const json = parseJson(text);
  if (!json.ok) {
    return err(configInvalid(`${PLUGINS_FILE} is not valid JSON: ${json.error}`));
  }
  if (!Array.isArray(json.value)) {
    return err(configInvalid(`${PLUGINS_FILE} must be a JSON array of plugin entries`));
  }
  const entries: PluginEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const firstIndex = new Map<string, number>();
  json.value.forEach((raw: unknown, index) => {
    const entry = parseEntry(raw);
    if (!entry.ok) {
      rejected.push({ index, issue: { kind: PluginIssueKind.EntryInvalid, detail: entry.error } });
      return;
    }
    const key = entryKey(entry.value);
    const first = firstIndex.get(key);
    if (first !== undefined) {
      const detail = `same plugin as entry ${String(first)}`;
      rejected.push({ index, issue: { kind: PluginIssueKind.DuplicateEntry, detail } });
      return;
    }
    firstIndex.set(key, index);
    entries.push(entry.value);
  });
  return ok({ entries, rejected });
};

/**
 * Reads and parses `<dataDir>/plugins.json`.
 *
 * @param dataDir - The absolute `DATA_DIR`.
 * @param read - Reads the file; {@link readTextFile} in the app, a fake in tests.
 * @returns As {@link parsePluginsConfig}, or `config_invalid` when the file exists but cannot be read.
 */
export const readPluginsConfig = async (
  dataDir: string,
  read: ReadTextFile,
): Promise<Result<PluginsConfig, PluginIssue>> => {
  const text = await read(join(dataDir, PLUGINS_FILE));
  return text.ok ? parsePluginsConfig(text.value) : err(configInvalid(`cannot read ${PLUGINS_FILE}: ${text.error}`));
};

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === MISSING_FILE;

/** Reads a UTF-8 file from disk with `node:fs`, refusing anything but a regular file so a pipe cannot block boot. */
export const readTextFile: ReadTextFile = async (path) => {
  try {
    if (!(await stat(path)).isFile()) {
      return err(NOT_A_FILE);
    }
    return ok(await readFile(path, "utf8"));
  } catch (error) {
    return isMissingFile(error) ? ok(null) : err(String(error));
  }
};
