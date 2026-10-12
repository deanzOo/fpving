import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = `${root}tests/tooling/fixtures/`;
const COLD_PROGRAM_TIMEOUT_MS = 60_000;

const results = new Map<string, string[]>();

const lint = (name: string): string[] => {
  const ruleIds = results.get(name);
  if (ruleIds === undefined) {
    throw new Error(`fixture not linted: ${name}`);
  }
  return ruleIds;
};

describe("lint rules", () => {
  beforeAll(async () => {
    const eslint = new ESLint({ cwd: root, ignore: false });
    for (const result of await eslint.lintFiles([`${FIXTURES}*.ts`])) {
      results.set(
        basename(result.filePath),
        result.messages.map((m) => m.ruleId ?? `fatal:${m.message}`),
      );
    }
  }, COLD_PROGRAM_TIMEOUT_MS);

  it.each([
    ["no-any.ts", "@typescript-eslint/no-explicit-any"],
    ["no-as.ts", "@typescript-eslint/consistent-type-assertions"],
    ["no-non-null.ts", "@typescript-eslint/no-non-null-assertion"],
    ["ts-ignore.ts", "@typescript-eslint/ban-ts-comment"],
    ["magic-number.ts", "@typescript-eslint/no-magic-numbers"],
    ["multi-line-comment.ts", "local/max-one-line-comment"],
    ["block-comment.ts", "local/max-one-line-comment"],
    ["todo-comment.ts", "no-warning-comments"],
    ["prefer-as-const.ts", "@typescript-eslint/prefer-as-const"],
    ["ts-expect-error.ts", "@typescript-eslint/ban-ts-comment"],
    ["ts-nocheck.ts", "@typescript-eslint/ban-ts-comment"],
    ["eslint-disable.ts", "@eslint-community/eslint-comments/no-use"],
  ])("reports %s as %s", (name, ruleId) => {
    expect(lint(name)).toContain(ruleId);
  });

  it("allows as const assertions", () => {
    expect(lint("as-const-ok.ts")).toEqual([]);
  });
});
