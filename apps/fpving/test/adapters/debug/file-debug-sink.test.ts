import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, PortErrorKind, pluginIdSchema } from "@fpving/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileDebugSink,
  DebugSinkRefusal,
  MAX_DEBUG_FOLDER_BYTES,
  MAX_DEBUG_PAGE_BYTES,
} from "../../../src/adapters/debug/file-debug-sink.ts";

const NOW = new Date("2026-10-29T10:11:12.345Z");
const STAMP = "2026-10-29T10-11-12-345Z";
const SHOP = pluginIdSchema.parse("example-shop");
const OTHER = pluginIdSchema.parse("other-shop");
const PAGE_BYTES = 1000;
const PAGES_UNDER_CAP = 3;
const EDGE_PAGES = 2;
const HUNDRED_MB = 104_857_600;
const URL_1 = "https://shop.example.com/p/1?ref=../../x";
const HTML = "<html>no price</html>";
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const PERMISSION_BITS = 0o777;
const HASH_PREFIX_LENGTH = 16;
const TWO_PAGES = 2;
const EURO_BYTES = 3;
const isWindows = process.platform === "win32";

const hashPrefix = (url: string): string => createHash("sha256").update(url).digest("hex").slice(0, HASH_PREFIX_LENGTH);

describe("File debug sink", () => {
  let dataDir: string;
  const sink = () => createFileDebugSink({ dataDir, clock: { now: () => NOW } });
  const pluginDir = () => join(dataDir, "debug", SHOP);

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "fpving-debug-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("saves the page under debug/<plugin>/ named by the time and a sha-256 prefix of the url", async () => {
    expect(await sink().savePage(SHOP, URL_1, HTML)).toEqual(ok(undefined));
    const file = join(pluginDir(), `${STAMP}-${hashPrefix(URL_1)}.html`);
    expect(await readFile(file, "utf8")).toBe(HTML);
    expect(await readdir(pluginDir())).toEqual([`${STAMP}-${hashPrefix(URL_1)}.html`]);
  });

  it("keeps two pages of different urls saved at the same instant apart", async () => {
    await sink().savePage(SHOP, URL_1, HTML);
    await sink().savePage(SHOP, "https://shop.example.com/p/2", HTML);
    expect(await readdir(pluginDir())).toHaveLength(TWO_PAGES);
  });

  it.skipIf(isWindows)("creates its folders readable by the owner only, and the page too", async () => {
    await sink().savePage(SHOP, URL_1, HTML);
    expect((await stat(join(dataDir, "debug"))).mode & PERMISSION_BITS).toBe(OWNER_ONLY_DIR);
    expect((await stat(pluginDir())).mode & PERMISSION_BITS).toBe(OWNER_ONLY_DIR);
    const [file = ""] = await readdir(pluginDir());
    expect((await stat(join(pluginDir(), file))).mode & PERMISSION_BITS).toBe(OWNER_ONLY_FILE);
  });

  it.each(["../escape", "a/b", "..", "Example-Shop", ""])(
    "refuses the plugin id %j instead of building a path from it, and writes nothing",
    async (pluginId) => {
      const result = await sink().savePage(pluginId, URL_1, HTML);
      expect(result).toEqual(err({ kind: PortErrorKind.DebugWriteFailed, detail: DebugSinkRefusal.InvalidPluginId }));
      expect(await readdir(dataDir)).toEqual([]);
    },
  );

  it("saves a page of exactly the size cap", async () => {
    expect(await sink().savePage(SHOP, URL_1, "a".repeat(MAX_DEBUG_PAGE_BYTES))).toEqual(ok(undefined));
  });

  it("refuses a page over the size cap, counted in utf-8 bytes, and writes nothing", async () => {
    const result = await sink().savePage(SHOP, URL_1, "€".repeat(Math.ceil(MAX_DEBUG_PAGE_BYTES / EURO_BYTES)));
    expect(result).toEqual(err({ kind: PortErrorKind.DebugWriteFailed, detail: DebugSinkRefusal.TooLarge }));
    expect(await readdir(dataDir)).toEqual([]);
  });

  describe("Bounding a plugin's folder", () => {
    const DAY_MS = 86_400_000;
    const KEPT_DAYS = 30;
    const PAGE = "x".repeat(PAGE_BYTES);
    const FOLDER_CAP = PAGE_BYTES * PAGES_UNDER_CAP;
    const folder = (id: string) => join(dataDir, "debug", id);
    const at = (time: number) => createFileDebugSink({
      dataDir,
      clock: { now: () => new Date(time) },
      maxFolderBytes: FOLDER_CAP,
    });
    const pagesIn = async (id: string) => (await readdir(folder(id))).sort();
    const nameAt = (time: number) => new Date(time).toISOString().replaceAll(/[:.]/gu, "-");
    const START = Date.parse("2026-10-01T00:00:00.000Z");

    it("deletes a plugin's pages older than 30 days when it saves a new one", async () => {
      await at(START).savePage(SHOP, "https://shop.example/old", "old");
      await at(START + KEPT_DAYS * DAY_MS + 1).savePage(SHOP, "https://shop.example/new", "new");
      const pages = await pagesIn(SHOP);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toContain(nameAt(START + KEPT_DAYS * DAY_MS + 1));
    });

    it("keeps a page exactly 30 days old", async () => {
      await at(START).savePage(SHOP, "https://shop.example/old", "old");
      await at(START + KEPT_DAYS * DAY_MS).savePage(SHOP, "https://shop.example/new", "new");
      expect(await pagesIn(SHOP)).toHaveLength(EDGE_PAGES);
    });

    it("deletes the oldest pages until the folder is under its size cap, keeping the newest", async () => {
      const times = Array.from({ length: PAGES_UNDER_CAP + 1 }, (_, index) => START + index);
      for (const time of times) {
        await at(time).savePage(SHOP, `https://shop.example/${String(time)}`, PAGE);
      }
      const pages = await pagesIn(SHOP);
      expect(pages).toHaveLength(PAGES_UNDER_CAP);
      expect(pages.some((name) => name.startsWith(nameAt(START)))).toBe(false);
      expect(pages.at(-1)).toContain(nameAt(START + PAGES_UNDER_CAP));
    });

    it("keeps the page it just saved even when that page alone is over the cap", async () => {
      await at(START).savePage(SHOP, "https://shop.example/a", PAGE);
      await at(START + 1).savePage(SHOP, "https://shop.example/b", PAGE.repeat(PAGES_UNDER_CAP + 1));
      const pages = await pagesIn(SHOP);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toContain(nameAt(START + 1));
    });

    it("leaves another plugin's pages and files that are not pages alone", async () => {
      await at(START).savePage(OTHER, "https://other.example/a", "other");
      await at(START).savePage(SHOP, "https://shop.example/a", "old");
      await writeFile(join(folder(SHOP), "notes.txt"), PAGE.repeat(PAGES_UNDER_CAP + 1));
      await at(START + KEPT_DAYS * DAY_MS + 1).savePage(SHOP, "https://shop.example/b", "new");
      expect(await pagesIn(OTHER)).toHaveLength(1);
      expect(await pagesIn(SHOP)).toContain("notes.txt");
      expect(await pagesIn(SHOP)).toHaveLength(EDGE_PAGES);
    });

    it("caps a folder at 100 megabytes unless told otherwise", () => {
      expect(MAX_DEBUG_FOLDER_BYTES).toBe(HUNDRED_MB);
    });
  });

  it("answers a write the file system refuses with debug_write_failed instead of rejecting", async () => {
    await writeFile(join(dataDir, "debug"), "a file where the folder should be");
    const result = await sink().savePage(SHOP, URL_1, HTML);
    expect(result).toMatchObject({ ok: false, error: { kind: PortErrorKind.DebugWriteFailed } });
  });
});
