import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { rawColourFindings } from "../../tools/ui-guards.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SCREEN_TSX = `${root}apps/ui/src/settings.tsx`;
const SCREEN_TS = `${root}apps/ui/src/money.ts`;
const PRIMITIVE_TSX = `${root}apps/ui/src/ui/button.tsx`;
const PRIMITIVE_TS = `${root}apps/ui/src/ui/link.ts`;
const UI_SOURCE = `${root}apps/ui/src`;
const STYLESHEET_FIXTURES = `${root}tests/tooling/fixtures/ui-stylesheets`;
const COLD_PROGRAM_TIMEOUT_MS = 120_000;
const GUARD_RULE = "no-restricted-syntax";

let eslint: ESLint;

const guardMessages = async (code: string, filePath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter(({ ruleId }) => ruleId === GUARD_RULE).map(({ message }) => message);
};

const classOn = (classes: string): string => `export const view = <div className="${classes}" />;\n`;

describe("Design system guards", () => {
  beforeAll(async () => {
    eslint = new ESLint({ cwd: root });
    await guardMessages(classOn("type-body"), SCREEN_TSX);
  }, COLD_PROGRAM_TIMEOUT_MS);

  describe("Raw colours in source", () => {
    it.each([
      ["a hex value in a screen", "export const c = \"#ff0000\";\n", SCREEN_TS],
      ["a short hex value in a screen", "export const c = \"#fff\";\n", SCREEN_TS],
      ["rgb() in a screen", "export const c = \"rgb(1, 2, 3)\";\n", SCREEN_TS],
      ["rgba() in a screen", "export const c = \"rgba(1, 2, 3, 0.5)\";\n", SCREEN_TS],
      ["hsl() in a screen", "export const c = \"hsl(1 2% 3%)\";\n", SCREEN_TS],
      ["oklch() in a screen", "export const c = \"oklch(0.5 0.1 200)\";\n", SCREEN_TS],
      ["a hex value in a template", "export const c = (n: number) => `#ff0000 ${n}`;\n", SCREEN_TS],
      ["a hex value in a JSX attribute", "export const v = <path fill=\"#000000\" />;\n", SCREEN_TSX],
      ["a hex value in a primitive", "export const c = \"#ff0000\";\n", PRIMITIVE_TS],
      ["an arbitrary hex class in a primitive", classOn("bg-[#ff0000]"), PRIMITIVE_TSX],
    ])("rejects %s and names the rule and the token to use", async (_case, code, filePath) => {
      const [message] = await guardMessages(code, filePath);
      expect(message).toContain("Design system rule 1");
      expect(message).toContain("tokens.json");
    });

    it.each([
      ["a token variable", "export const c = \"var(--color-ink)\";\n", SCREEN_TS],
      ["a token variable in a primitive", "export const c = \"var(--color-ink)\";\n", PRIMITIVE_TS],
      ["an anchor that is not hex", "export const c = \"#main\";\n", SCREEN_TS],
      ["a hash of a length no colour has", "export const c = \"#12345\";\n", SCREEN_TS],
    ])("accepts %s", async (_case, code, filePath) => {
      expect(await guardMessages(code, filePath)).toEqual([]);
    });
  });

  describe("Raw colours in stylesheets", () => {
    it("reports every raw colour with its file, the rule and the token to use", async () => {
      const findings = await rawColourFindings(STYLESHEET_FIXTURES);
      expect(findings.find((finding) => finding.startsWith("raw.css: #fff: "))).toContain("Design system rule 1");
      expect(findings.find((finding) => finding.startsWith("raw.css: oklch("))).toContain("tokens.json");
    });

    it("reports a stylesheet in a subfolder even when it is named tokens.css", async () => {
      const findings = await rawColourFindings(STYLESHEET_FIXTURES);
      expect(findings.some((finding) => finding.startsWith("ui/tokens.css: hsl("))).toBe(true);
    });

    it("leaves out the generated tokens.css and a clean stylesheet", async () => {
      const findings = await rawColourFindings(STYLESHEET_FIXTURES);
      expect(findings.filter((finding) => /^(?:tokens|clean)\.css/u.test(finding))).toEqual([]);
    });

    it("finds none in the UI's own stylesheets", async () => {
      expect(await rawColourFindings(UI_SOURCE)).toEqual([]);
    });
  });
});
