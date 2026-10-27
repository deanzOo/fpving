import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MATCHER_EVAL_SKIPPED } from "./matcher-eval.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JITI = join(ROOT, "node_modules", "jiti", "lib", "jiti-cli.mjs");
const CLI = join(ROOT, "tools", "matcher-eval-cli.ts");
const CLI_TIMEOUT_MS = 30_000;
const SOURCE_CONDITIONS = "--conditions=@fpving/source";

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

const runWithEnvFile = async (contents: string | null): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), "fpving-matcher-eval-"));
  const envFile = join(dir, ".env");
  if (contents !== null) {
    await writeFile(envFile, contents);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "ANTHROPIC_API_KEY"));
  const args = [SOURCE_CONDITIONS, `--env-file-if-exists=${envFile}`, JITI, CLI];
  return execFileSync(process.execPath, args, { env, encoding: "utf8" });
};

describe("Matcher eval command", () => {
  it("skips and exits 0 without an env file or an ANTHROPIC_API_KEY", async () => {
    expect(await runWithEnvFile(null)).toContain(MATCHER_EVAL_SKIPPED);
  }, CLI_TIMEOUT_MS);

  it("skips and exits 0 when the env file sets a whitespace-only ANTHROPIC_API_KEY", async () => {
    expect(await runWithEnvFile("ANTHROPIC_API_KEY=\"   \"\n")).toContain(MATCHER_EVAL_SKIPPED);
  }, CLI_TIMEOUT_MS);
});
