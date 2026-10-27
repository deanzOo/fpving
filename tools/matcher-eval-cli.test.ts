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

const SDK_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CONFIG_DIR",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_ENVIRONMENT_ID",
  "ANTHROPIC_ENVIRONMENT_KEY",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_SCOPE",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
  "ANTHROPIC_SESSION_ID",
  "ANTHROPIC_WORK_ID",
  "ANTHROPIC_WORK_SECRET",
  "ANTHROPIC_WORKSPACE_ID",
] as const;
const UNREACHABLE_BASE_URL = "http://127.0.0.1:9";

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

const isolatedEnv = (shell: NodeJS.ProcessEnv, configDir: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(shell).filter(([name]) => !SDK_ENV_VARS.some((sdkVar) => sdkVar === name))),
  ANTHROPIC_CONFIG_DIR: configDir,
  ANTHROPIC_BASE_URL: UNREACHABLE_BASE_URL,
});

const runWithEnvFile = async (contents: string | null, shell: NodeJS.ProcessEnv = process.env): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), "fpving-matcher-eval-"));
  const envFile = join(dir, ".env");
  if (contents !== null) {
    await writeFile(envFile, contents);
  }
  const args = [SOURCE_CONDITIONS, `--env-file-if-exists=${envFile}`, JITI, CLI];
  return execFileSync(process.execPath, args, { env: isolatedEnv(shell, dir), encoding: "utf8" });
};

describe("Matcher eval command", () => {
  it("skips and exits 0 without an env file or an ANTHROPIC_API_KEY", async () => {
    expect(await runWithEnvFile(null)).toContain(MATCHER_EVAL_SKIPPED);
  }, CLI_TIMEOUT_MS);

  it("skips and exits 0 when the env file sets a whitespace-only ANTHROPIC_API_KEY", async () => {
    expect(await runWithEnvFile("ANTHROPIC_API_KEY=\"   \"\n")).toContain(MATCHER_EVAL_SKIPPED);
  }, CLI_TIMEOUT_MS);

  it("skips when the shell sets Anthropic credentials, none of which reach the command", async () => {
    const shell = Object.fromEntries(SDK_ENV_VARS.map((name) => [name, "test-value-not-a-real-secret"]));
    expect(await runWithEnvFile(null, { ...process.env, ...shell })).toContain(MATCHER_EVAL_SKIPPED);
  }, CLI_TIMEOUT_MS);
});
