import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { rawColourFindings } from "../../tools/ui-stylesheet-guard.ts";

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
      ["an arbitrary colour on a border side", "border-x-[red]"],
      ["a palette colour on a border side", "border-t-red-500"],
      ["a palette colour on a ring offset", "ring-offset-red-500"],
      ["an arbitrary colour on a ring offset", "ring-offset-[red]"],
      ["a variable text colour", "text-(--x)"],
      ["a variable fill", "bg-(--my-colour)"],
      ["a variable colour on a border side", "border-t-(--x)"],
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

  describe("Arbitrary property classes", () => {
    it.each([
      ["a colour", "[color:red]"],
      ["an opacity", "[opacity:0.5]"],
      ["a font size", "[font-size:13px]"],
      ["a custom property", "[--x:1px]"],
      ["a property behind a variant", "hover:[color:red]"],
      ["an important property", "![color:red]"],
    ])("rejects %s in a screen and names the rule and what to use", async (_case, classes) => {
      const [message] = await guardMessages(classOn(classes), SCREEN_TSX);
      expect(message).toContain("Design system rule 1");
      expect(message).toContain("arbitrary property");
    });

    it("rejects a property whose value comes from a template", async () => {
      const code = "export const c = (n: string) => `[color:${n}]`;\n";
      expect(await guardMessages(code, SCREEN_TS)).toHaveLength(1);
    });

    it.each([
      ["a variant with an arbitrary selector", "has-[p]:mt-2"],
      ["a variant with a pseudo-class", "has-[:checked]:mt-2"],
      ["an arbitrary variant", "[&>p]:mt-2"],
      ["an arbitrary layout size", "w-[137px]"],
    ])("accepts %s in a screen", async (_case, classes) => {
      expect(await guardMessages(classOn(classes), SCREEN_TSX)).toEqual([]);
    });

    it("accepts a sentence that opens with a bracketed note", async () => {
      expect(await guardMessages("export const c = \"[note: see the log]\";\n", SCREEN_TS)).toEqual([]);
    });

    it("does not apply to a primitive", async () => {
      expect(await guardMessages(classOn("[color:red]"), PRIMITIVE_TSX)).toEqual([]);
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

  describe("Opacity for pending", () => {
    it.each(["opacity-50", "disabled:opacity-40", "aria-disabled:opacity-60"])(
      "rejects %s in a screen and names the rule and what to use",
      async (classes) => {
        const [message] = await guardMessages(classOn(classes), SCREEN_TSX);
        expect(message).toContain("Design system rule 7");
        expect(message).toContain("aria-disabled");
      },
    );

    it("rejects an opacity class in a template in a screen", async () => {
      const code = "export const c = (n: string) => `opacity-50 ${n}`;\n";
      expect(await guardMessages(code, SCREEN_TS)).toHaveLength(1);
    });

    it("accepts a pending style that keeps its opacity", async () => {
      expect(await guardMessages(classOn("aria-disabled:cursor-progress"), SCREEN_TSX)).toEqual([]);
    });

    it("does not apply to a primitive", async () => {
      expect(await guardMessages(classOn("opacity-50"), PRIMITIVE_TSX)).toEqual([]);
    });
  });

  describe("Raw typography", () => {
    it.each(["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-9xl", "md:text-lg", "text-sm/6",
      "font-thin", "font-extralight", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold",
      "font-extrabold", "font-black", "font-[700]", "leading-3", "leading-[1.1]", "tracking-wide", "tracking-[.2em]"])(
      "rejects %s in a screen and names the rule and what to use",
      async (classes) => {
        const [message] = await guardMessages(classOn(classes), SCREEN_TSX);
        expect(message).toContain("Design system type rule");
        expect(message).toContain("type-");
      },
    );

    it("rejects a raw size in a plain string in a screen's module", async () => {
      expect(await guardMessages("export const c = \"text-sm\";\n", SCREEN_TS)).toHaveLength(1);
    });

    it.each(["type-body", "type-readout-lg", "text-ink-muted", "text-left", "font-sans", "font-mono"])(
      "accepts %s in a screen",
      async (classes) => {
        expect(await guardMessages(classOn(classes), SCREEN_TSX)).toEqual([]);
      },
    );

    it("does not apply to a primitive", async () => {
      expect(await guardMessages(classOn("text-sm font-bold"), PRIMITIVE_TSX)).toEqual([]);
    });
  });

  describe("Radii and shadows", () => {
    it.each(["rounded-full", "rounded-md", "rounded-[7px]", "rounded-t-lg", "hover:rounded-1", "shadow-md",
      "shadow-(--shadow-dialog)", "hover:shadow-lg", "drop-shadow-md"])(
      "rejects %s in a screen and names the rule and what to use",
      async (classes) => {
        const message = (await guardMessages(classOn(classes), SCREEN_TSX)).join();
        expect(message).toContain("Design system shape rule");
        expect(message).toContain("primitive");
      },
    );

    it("does not apply to a primitive", async () => {
      expect(await guardMessages(classOn("rounded-2 shadow-(--shadow-dialog)"), PRIMITIVE_TSX)).toEqual([]);
    });
  });

  describe("Inline styles", () => {
    it.each([
      ["a colour", "{ color: \"red\" }"],
      ["an opacity", "{ opacity: 0.5 }"],
      ["a font size", "{ fontSize: 13 }"],
    ])("rejects %s in a screen and names the rule and what to use", async (_case, style) => {
      const [message] = await guardMessages(`export const v = <div style={${style}} />;\n`, SCREEN_TSX);
      expect(message).toContain("Design system rule 1");
      expect(message).toContain("type-*");
    });

    it("does not apply to a primitive", async () => {
      expect(await guardMessages("export const v = <div style={{ color: \"red\" }} />;\n", PRIMITIVE_TSX)).toEqual([]);
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
