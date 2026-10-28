import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseEnv as parseDotenv } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "../apps/fpving/src/config/env.ts";
import { fnv1a, initWorktree, portFor, renderEnv } from "./worktree-init.ts";

const HEX_RADIX = 16;
const FOOBAR_HASH = 0xbf_9c_f9_68;
const PORT_BASE = 4000;
const PORT_LIMIT = 5000;
const PORT_SPAN = 1000;
const TEMPLATE = "PORT=4000\nDATA_DIR=.data/main\n# ANTHROPIC_API_KEY=\nLOG_LEVEL=info\n";

describe("FNV-1a hash", () => {
  it.each([
    ["", "811c9dc5"],
    ["a", "e40c292c"],
    ["foobar", "bf9cf968"],
  ])("matches the reference vector for %j", (text, expected) => {
    expect(fnv1a(text).toString(HEX_RADIX)).toBe(expected);
  });

  it("is deterministic and distinguishes different input", () => {
    expect(fnv1a("/work/a")).toBe(fnv1a("/work/a"));
    expect(fnv1a("/work/a")).not.toBe(fnv1a("/work/b"));
  });
});

describe("Worktree port", () => {
  it("is 4000 plus the hash modulo 1000", () => {
    expect(portFor("foobar")).toBe(PORT_BASE + (FOOBAR_HASH % PORT_SPAN));
  });

  it("stays within 4000 to 4999 for any path", () => {
    for (const path of ["/", "/a", "/Users/x/.worktrees/adapters", "C:\\work\\tree"]) {
      expect(portFor(path)).toBeGreaterThanOrEqual(PORT_BASE);
      expect(portFor(path)).toBeLessThan(PORT_LIMIT);
    }
  });
});

describe("Env rendering", () => {
  it("replaces the port and data dir and keeps every other line", () => {
    expect(renderEnv(TEMPLATE, { port: 4123, dataDir: "/w/adapters/.data/adapters" })).toBe(
      "PORT=4123\nDATA_DIR=/w/adapters/.data/adapters\n# ANTHROPIC_API_KEY=\nLOG_LEVEL=info\n",
    );
  });
});

describe("Env rendering safety", () => {
  it("writes replacement patterns in a directory name literally", () => {
    const dataDir = "/w/$&-$1/.data/x";
    expect(renderEnv(TEMPLATE, { port: 4123, dataDir })).toContain(`DATA_DIR=${dataDir}\n`);
  });

  it.each(["DATA_DIR=.data/main\n", "PORT=4000\n"])("fails when the template lacks a line (%j only)", (template) => {
    expect(() => renderEnv(template, { port: 4123, dataDir: "/w/.data/x" })).toThrow(/PORT=|DATA_DIR=/);
  });
});

describe("Worktree init", () => {
  let root = "";

  beforeEach(async () => {
    root = join(await mkdtemp(join(tmpdir(), "fpving-wt-")), "my-tree");
    await mkdir(root);
    await writeFile(join(root, ".env.example"), TEMPLATE);
  });

  afterEach(async () => {
    await rm(join(root, ".."), { recursive: true, force: true });
  });

  it("writes a valid .env with the hashed port and a data dir named after the worktree", async () => {
    const result = await initWorktree(root);
    const text = await readFile(join(root, ".env"), "utf8");
    const dataDir = join(resolve(root), ".data", "my-tree");
    expect(result).toEqual({ status: "created", port: portFor(root), dataDir });
    expect(text).toContain(`PORT=${String(portFor(root))}\n`);
    expect(text).toContain(`DATA_DIR=${dataDir}\n`);
    const values = Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        .map((line): [string, string] => {
          const [name = "", value = ""] = line.split("=");
          return [name, value];
        }),
    );
    expect(parseEnv(values).ok).toBe(true);
  });

  it("never overwrites an existing .env", async () => {
    await writeFile(join(root, ".env"), "PORT=1111\n");
    const result = await initWorktree(root);
    expect(result).toEqual({ status: "exists" });
    expect(await readFile(join(root, ".env"), "utf8")).toBe("PORT=1111\n");
  });

  it("reports a missing .env.example instead of writing anything", async () => {
    await rm(join(root, ".env.example"));
    await expect(initWorktree(root)).rejects.toThrow(/\.env\.example/);
  });
});

describe("The committed .env.example", () => {
  const example = async (): Promise<string> =>
    readFile(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");

  it("fails validation when copied by hand, because DATA_DIR is left empty", async () => {
    const parsed = parseEnv(parseDotenv(await example()));
    expect(parsed).toMatchObject({
      ok: false,
      error: { issues: [{ variable: "DATA_DIR", message: "must not be empty" }] },
    });
  });

  it("passes validation once worktree:init has filled it in", async () => {
    const dataDir = "/w/adapters/.data/adapters";
    const rendered = renderEnv(await example(), { port: 4123, dataDir });
    expect(parseEnv(parseDotenv(rendered))).toMatchObject({ ok: true, value: { DATA_DIR: dataDir } });
  });
});
