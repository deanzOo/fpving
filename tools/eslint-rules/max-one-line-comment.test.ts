import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { maxOneLineComment } from "./max-one-line-comment.ts";

RuleTester.describe = describe;
RuleTester.it = it;

describe("max-one-line-comment", () => {
  new RuleTester().run("max-one-line-comment", maxOneLineComment, {
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
    ],
  });
});
