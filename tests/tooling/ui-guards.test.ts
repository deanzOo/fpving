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

  describe("Tailwind palette and arbitrary colour classes", () => {
    it.each([
      ["a palette text colour", "text-red-500"],
      ["a palette fill behind a variant", "hover:bg-slate-100"],
      ["a palette colour with an alpha", "border-zinc-700/50"],
      ["white", "text-white"],
      ["black", "bg-black"],
      ["an arbitrary named colour", "bg-[red]"],
      ["an arbitrary variable colour", "ring-[var(--other)]"],
      ["an arbitrary hex colour", "text-[#123456]"],
    ])("rejects %s in a screen and names the rule and what to use", async (_case, classes) => {
      const messages = await guardMessages(classOn(classes), SCREEN_TSX);
      expect(messages.join()).toContain("Design system rule 1");
      expect(messages.join()).toContain("token utility");
    });

    it("rejects a palette class in a plain string in a screen's module", async () => {
      expect(await guardMessages("export const c = \"text-red-500\";\n", SCREEN_TS)).toHaveLength(1);
    });

    it.each([
      ["token utilities", "text-ink bg-surface border-line-strong text-on-signal"],
      ["a transparent border", "border-transparent"],
      ["a variant with an arbitrary selector", "has-[p]:mt-2"],
      ["an arbitrary width", "max-w-[calc(var(--content-max)/2)]"],
      ["a size token by variable", "min-h-(--row-height)"],
    ])("accepts %s in a screen", async (_case, classes) => {
      expect(await guardMessages(classOn(classes), SCREEN_TSX)).toEqual([]);
    });

    it("does not apply to a primitive", async () => {
      expect(await guardMessages(classOn("text-red-500"), PRIMITIVE_TSX)).toEqual([]);
    });
  });

  describe("Native controls", () => {
    it.each([
      ["button", "Button"],
      ["input", "TextField or Checkbox"],
      ["select", "Select"],
      ["textarea", "TextField"],
      ["table", "DataTable"],
      ["dialog", "Confirm"],
    ])("rejects a native %s in a screen and names %s", async (element, primitive) => {
      const [message] = await guardMessages(`export const view = <${element} />;\n`, SCREEN_TSX);
      expect(message).toContain("Design system rule 2");
      expect(message).toContain(`<${element}>`);
      expect(message).toContain(primitive);
    });

    it("accepts a native control in a primitive", async () => {
      expect(await guardMessages("export const view = <button />;\n", PRIMITIVE_TSX)).toEqual([]);
    });

    it("accepts a primitive and other native elements in a screen", async () => {
      const code = "declare const Button: () => null;\nexport const view = <div><Button /></div>;\n";
      expect(await guardMessages(code, SCREEN_TSX)).toEqual([]);
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
