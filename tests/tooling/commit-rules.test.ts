import { fileURLToPath } from "node:url";
import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { describe, expect, it } from "vitest";
import { BODY_LINE_MAX, COMMIT_SCOPES, COMMIT_TYPES, SUBJECT_MAX } from "../../tools/commit-rules.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function check(message: string) {
  const config = await load({}, { cwd: ROOT });
  return lint(message, config.rules, {
    parserOpts: config.parserPreset?.parserOpts ?? {},
    plugins: config.plugins,
  });
}

describe("commit rules", () => {
  it("accepts a typed and scoped subject", async () => {
    expect((await check("feat(core): add money type")).valid).toBe(true);
  });

  it("accepts a subject without a scope", async () => {
    expect((await check("chore: bump deps")).valid).toBe(true);
  });

  it("rejects a capitalised type and subject", async () => {
    expect((await check("Feat: X")).valid).toBe(false);
  });

  it("rejects a subject starting with a capital", async () => {
    expect((await check("feat: Add money type")).valid).toBe(false);
  });

  it("rejects an unknown type", async () => {
    expect((await check("wip(core): add money type")).valid).toBe(false);
  });

  it("rejects an unknown scope", async () => {
    expect((await check("feat(foo): x")).valid).toBe(false);
  });

  it("rejects a subject longer than the maximum", async () => {
    const subject = "x".repeat(SUBJECT_MAX + 1 - "feat: ".length);
    expect((await check(`feat: ${subject}`)).valid).toBe(false);
  });

  it("accepts a subject exactly at the maximum", async () => {
    const subject = "x".repeat(SUBJECT_MAX - "feat: ".length);
    expect((await check(`feat: ${subject}`)).valid).toBe(true);
  });

  it("rejects a subject with a trailing period", async () => {
    expect((await check("feat(core): add money type.")).valid).toBe(false);
  });

  it("rejects a body line longer than the maximum", async () => {
    const body = "y".repeat(BODY_LINE_MAX + 1);
    expect((await check(`feat: add thing\n\n${body}`)).valid).toBe(false);
  });

  it("rejects a footer line longer than the maximum", async () => {
    const footer = `Refs: ${"z".repeat(BODY_LINE_MAX)}`;
    expect((await check(`feat: add thing\n\nbody\n\n${footer}`)).valid).toBe(false);
  });

  it("exposes the agreed types and scopes", () => {
    expect(COMMIT_TYPES).toEqual(["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "revert"]);
    expect(COMMIT_SCOPES).toEqual(["core", "plugin-sdk", "plugins", "matcher", "pricing", "alerts", "scheduler", "db", "ui", "api", "ci", "deps"]);
  });
});
