import { glob, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const DESCRIBE = /\bdescribe\(\s*"([^"]+)"/g;
const SENTENCE_CASE = /^[A-Z0-9]/;

const describeNames = async (pattern: string): Promise<string[]> => {
  const names: string[] = [];
  for await (const file of glob(pattern)) {
    const source = await readFile(file, "utf8");
    names.push(...[...source.matchAll(DESCRIBE)].map(([, name = ""]) => `${file}: ${name}`));
  }
  return names;
};

describe("Behaviour spec headings", () => {
  it("starts every package describe name with a capital, so the spec reads in sentence case", async () => {
    const names = [
      ...(await describeNames("packages/*/test/**/*.test.ts")),
      ...(await describeNames("packages/*/src/**/*.ts")),
    ];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !SENTENCE_CASE.test(name.split(": ").slice(1).join(": ")))).toEqual([]);
  });
});
