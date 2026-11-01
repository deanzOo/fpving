import { glob, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const CALL = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const QUOTE = "[\"'`]";
const DESCRIBE = new RegExp(String.raw`\bdescribe(?:\.\w+(?:${CALL})?)*\(\s*(${QUOTE})((?:(?!\1)[\s\S])+)\1`, "gu");
const SENTENCE_CASE = /^[A-Z0-9]/;

const namesIn = (source: string): string[] => [...source.matchAll(DESCRIBE)].map(([, , name = ""]) => name);

const describeNames = async (pattern: string): Promise<string[]> => {
  const names: string[] = [];
  for await (const file of glob(pattern)) {
    names.push(...namesIn(await readFile(file, "utf8")).map((name) => `${file}: ${name}`));
  }
  return names;
};

describe("Describe name collection", () => {
  it.each([
    ["a plain call", "describe(\"Plain\", () => {});", "Plain"],
    ["a single-quoted name", "describe('Single quoted', () => {});", "Single quoted"],
    ["a template literal name", "describe(`Template ${id}`, () => {});", "Template ${id}"],
    ["describe.skip", "describe.skip(\"Skipped\", () => {});", "Skipped"],
    ["describe.only", "describe.only(\"Only\", () => {});", "Only"],
    ["describe.each", "describe.each([[\"a\", 1]])(\"Each %s\", () => {});", "Each %s"],
    ["describe.skipIf with the name on the next line", "describe.skipIf(!ready(x))(\n  \"Skip if\",\n  () => {});",
      "Skip if"],
    ["describe.runIf", "describe.runIf(isLinux)(\"Run if\", () => {});", "Run if"],
  ])("finds the name of %s", (_form, source, name) => {
    expect(namesIn(source)).toEqual([name]);
  });
});

describe("Behaviour spec headings", () => {
  it("starts every describe name with a capital, so the spec reads in sentence case", async () => {
    const names = [
      ...(await describeNames("packages/*/test/**/*.test.ts")),
      ...(await describeNames("packages/*/src/**/*.ts")),
      ...(await describeNames("apps/*/src/**/*.{ts,tsx}")),
      ...(await describeNames("apps/*/test/**/*.test.ts")),
      ...(await describeNames("apps/*/test/**/*.test.tsx")),
      ...(await describeNames("tools/**/*.test.ts")),
      ...(await describeNames("tests/**/*.test.ts")),
    ];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !SENTENCE_CASE.test(name.split(": ").slice(1).join(": ")))).toEqual([]);
  });
});
