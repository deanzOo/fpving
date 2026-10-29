import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { err, ok } from "@fpving/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_NPM_NAME_LENGTH,
  NOT_A_FILE,
  parsePluginsConfig,
  PLUGINS_FILE,
  readPluginsConfig,
  readTextFile,
} from "../../src/plugins/config.ts";
import { PluginIssueKind } from "../../src/plugins/status.ts";

const DATA_DIR = "/data";
const HOME = resolve(tmpdir(), "pilot");
const PLUGIN_DIR = join(HOME, "plugins", "example-shop");
const ROOTED_NAME_DIR = resolve(tmpdir(), "fpving-plugin-example");
const isWindows = process.platform === "win32";
const OVERLONG_NPM_NAME = "x".repeat(MAX_NPM_NAME_LENGTH + 1);

const parse = (value: unknown): ReturnType<typeof parsePluginsConfig> => parsePluginsConfig(JSON.stringify(value));

describe("Plugin list config", () => {
  it("treats a missing plugins.json as no plugins", () => {
    expect(parsePluginsConfig(null)).toEqual(ok({ entries: [], rejected: [] }));
  });

  it("accepts absolute folder paths and npm package names", () => {
    const entries = [{ path: PLUGIN_DIR }, { package: "fpving-plugin-example" }, { package: "@pilot/fpving-shop" }];
    expect(parse(entries)).toEqual(ok({ entries, rejected: [] }));
  });

  it("normalizes a folder path, so dot segments and a trailing slash name the same folder", () => {
    const unnormalized = [HOME, "x", "..", "plugins", "example-shop", ""].join(sep);
    expect(parse([{ path: unnormalized }])).toEqual(
      ok({ entries: [{ path: PLUGIN_DIR }], rejected: [] }),
    );
  });

  it("fails the whole file with a reason when it is not valid JSON", () => {
    const parsed = parsePluginsConfig("[{ path: ");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe(PluginIssueKind.ConfigInvalid);
      expect(parsed.error.detail).toMatch(/^plugins\.json is not valid JSON: /u);
    }
  });

  it.each([{}, "plugins", null, { path: PLUGIN_DIR }])("fails the whole file when it is not an array: %j", (value) => {
    expect(parse(value)).toEqual(
      err({ kind: PluginIssueKind.ConfigInvalid, detail: "plugins.json must be a JSON array of plugin entries" }),
    );
  });

  it.each([
    [{ path: "plugins/example-shop" }, /^path: must be an absolute path$/u],
    [{ path: "./example-shop" }, /^path: must be an absolute path$/u],
    [{ package: "Not A Name" }, /^package: must be an npm package name$/u],
    [{ package: OVERLONG_NPM_NAME }, /^package: must be an npm package name$/u],
    [{ path: PLUGIN_DIR, package: "fpving-plugin-example" }, /package/u],
    [{ name: "example" }, /^package: .*name/u],
    ["fpving-plugin-example", /object/u],
  ])("disables only the invalid entry %j, with the reason", (bad, detail) => {
    const parsed = parse([{ path: PLUGIN_DIR }, bad]);
    expect(parsed.ok && parsed.value.entries).toEqual([{ path: PLUGIN_DIR }]);
    const rejected = parsed.ok ? parsed.value.rejected : [];
    expect(rejected.map(({ index, issue }) => ({ index, kind: issue.kind }))).toEqual([
      { index: 1, kind: PluginIssueKind.EntryInvalid },
    ]);
    expect(rejected[0]?.issue.detail).toMatch(detail);
  });

  it("keeps the first of duplicate entries and reports each later one", () => {
    const parsed = parse([
      { path: PLUGIN_DIR },
      { package: "fpving-plugin-example" },
      { path: `${PLUGIN_DIR}${sep}` },
      { package: "fpving-plugin-example" },
    ]);
    expect(parsed).toEqual(
      ok({
        entries: [{ path: PLUGIN_DIR }, { package: "fpving-plugin-example" }],
        rejected: [
          { index: 2, issue: { kind: PluginIssueKind.DuplicateEntry, detail: "same plugin as entry 0" } },
          { index: 3, issue: { kind: PluginIssueKind.DuplicateEntry, detail: "same plugin as entry 1" } },
        ],
      }),
    );
  });

  it("does not treat a folder path and a package of the same text as duplicates", () => {
    const entries = [{ path: ROOTED_NAME_DIR }, { package: "fpving-plugin-example" }];
    expect(parse(entries)).toEqual(ok({ entries, rejected: [] }));
  });

  it("reads plugins.json from the data dir through the injected reader", async () => {
    const asked: string[] = [];
    const parsed = await readPluginsConfig(DATA_DIR, (path) => {
      asked.push(path);
      return Promise.resolve(ok(JSON.stringify([{ package: "fpving-plugin-example" }])));
    });
    expect(asked).toEqual([join(DATA_DIR, PLUGINS_FILE)]);
    expect(parsed).toEqual(ok({ entries: [{ package: "fpving-plugin-example" }], rejected: [] }));
  });

  it("fails the whole file with a reason when the reader cannot read it", async () => {
    const parsed = await readPluginsConfig(DATA_DIR, () => Promise.resolve(err("EACCES: permission denied")));
    expect(parsed).toEqual(
      err({ kind: PluginIssueKind.ConfigInvalid, detail: "cannot read plugins.json: EACCES: permission denied" }),
    );
  });
});

describe("Text file reader", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fpving-plugins-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a file as UTF-8", async () => {
    await writeFile(join(dir, PLUGINS_FILE), "[]", "utf8");
    expect(await readTextFile(join(dir, PLUGINS_FILE))).toEqual(ok("[]"));
  });

  it("returns null for a missing file", async () => {
    expect(await readTextFile(join(dir, PLUGINS_FILE))).toEqual(ok(null));
  });

  it("refuses a directory without reading it", async () => {
    await mkdir(join(dir, PLUGINS_FILE));
    expect(await readTextFile(join(dir, PLUGINS_FILE))).toEqual(err(NOT_A_FILE));
  });

  it("returns the reason when the path cannot be read", async () => {
    const read = await readTextFile(join(dir, "nul\0byte"));
    expect(read.ok).toBe(false);
    expect(read.ok ? "" : read.error).toMatch(/\S/u);
  });

  it.skipIf(isWindows)("refuses a named pipe instead of blocking on it", async () => {
    execFileSync("mkfifo", [join(dir, PLUGINS_FILE)]);
    expect(await readTextFile(join(dir, PLUGINS_FILE))).toEqual(err(NOT_A_FILE));
  });
});
