import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { maxOneLineComment } from "./max-one-line-comment.ts";

RuleTester.describe = describe;
RuleTester.it = it;

describe("max-one-line-comment", () => {
  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("max-one-line-comment", maxOneLineComment, {
    valid: [
      "// one\nconst a = 1;",
      "// one\nconst a = 1;\n// two\nconst b = 2;",
      "/** doc */\nexport const a = 1;",
      "/**\n * doc\n * more\n */\nexport const a = 1;",
      "const a = 1; // trailing",
      "const a = 1; // x\nconst b = 2; // y",
      "// standalone\nconst a = 1; // trailing",
      "/** doc */\nexport function f() {}",
      "/** doc */\nexport default 1;",
      "export interface A {\n  /** doc */\n  readonly x: number;\n  /** method */\n  f(): void;\n}",
      "export type T = {\n  /** doc */\n  x: number;\n};",
      "export class C {\n  /** doc */\n  x = 1;\n  /** method */\n  m(): void {}\n}",
      "export class C {\n  /** overload */\n  m(a: string): void;\n  m(a: number): void;\n  m(a: unknown): void {}\n}",
      "export enum E {\n  /** doc */\n  A,\n}",
      "export default class {\n  /** doc */\n  x = 1;\n}",
    ],
    invalid: [
      { code: "// one\n// two\nconst a = 1;", errors: [{ messageId: "multi" }] },
      { code: "// one\n// two\n// three\nconst a = 1;", errors: [{ messageId: "multi" }, { messageId: "multi" }] },
      { code: "/* block */\nconst a = 1;", errors: [{ messageId: "block" }] },
      { code: "/*\n multi\n*/\nconst a = 1;", errors: [{ messageId: "block" }] },
      { code: "const a = 1; // x\n// y\nconst b = 2;", errors: [{ messageId: "multi" }] },
      { code: "/** doc */\nconst a = 1;", errors: [{ messageId: "jsdoc" }] },
      { code: "/** doc */\nfunction f() {}\nexport { f };", errors: [{ messageId: "jsdoc" }] },
      { code: "const a = 1;\n/** floating */", errors: [{ messageId: "jsdoc" }] },
      { code: "/** floating */\n\n// note\nconst a = 1;", errors: [{ messageId: "jsdoc" }] },
      { code: "/** doc */\n// note\nexport const a = 1;", errors: [{ messageId: "jsdoc" }] },
      { code: "interface A {\n  /** doc */\n  x: number;\n}\nexport { A };", errors: [{ messageId: "jsdoc" }] },
      { code: "class C {\n  /** doc */\n  x = 1;\n}\nexport { C };", errors: [{ messageId: "jsdoc" }] },
      { code: "export function f() {\n  /** doc */\n  const a = 1;\n  return a;\n}", errors: [{ messageId: "jsdoc" }] },
      {
        code: "export function f() {\n  class C {\n    /** doc */\n    x = 1;\n  }\n  return C;\n}",
        errors: [{ messageId: "jsdoc" }],
      },
    ],
  });
});
