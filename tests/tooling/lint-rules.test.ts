import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = (name: string): string => `${root}tests/tooling/fixtures/${name}`;

const lint = async (name: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: root, ignore: false });
  const [result] = await eslint.lintFiles([fixture(name)]);
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
};

describe("lint rules", () => {
  it.each([
    ["no-any.ts", "@typescript-eslint/no-explicit-any"],
    ["no-as.ts", "@typescript-eslint/consistent-type-assertions"],
    ["no-non-null.ts", "@typescript-eslint/no-non-null-assertion"],
    ["ts-ignore.ts", "@typescript-eslint/ban-ts-comment"],
    ["magic-number.ts", "@typescript-eslint/no-magic-numbers"],
    ["multi-line-comment.ts", "local/max-one-line-comment"],
    ["block-comment.ts", "local/max-one-line-comment"],
    ["eslint-disable.ts", "@eslint-community/eslint-comments/no-use"],
  ])("reports %s as %s", async (name, ruleId) => {
    expect(await lint(name)).toContain(ruleId);
  });

  it("allows as const assertions", async () => {
    expect(await lint("as-const-ok.ts")).toEqual([]);
  });
});
