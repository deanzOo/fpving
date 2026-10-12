import type { Rule } from "eslint";

export const maxOneLineComment: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      block: "Block comments are not allowed; use a single // line or JSDoc on an export.",
      jsdoc: "JSDoc blocks are allowed only directly before an export.",
      multi: "Comments must be a single line.",
    },
  },
  create(context) {
    return {
      Program() {
        let previousLine: number | undefined;
        for (const comment of context.sourceCode.getAllComments()) {
          const loc = context.sourceCode.getLoc(comment);
          if (comment.type === "Block") {
            if (!comment.value.startsWith("*")) {
              context.report({ loc, messageId: "block" });
            } else if (context.sourceCode.getTokenAfter(comment)?.value !== "export") {
              context.report({ loc, messageId: "jsdoc" });
            }
            previousLine = undefined;
            continue;
          }
          const trailing = context.sourceCode.getTokenBefore(comment)?.loc.end.line === loc.start.line;
          if (!trailing && previousLine !== undefined && loc.start.line === previousLine + 1) {
            context.report({ loc, messageId: "multi" });
          }
          previousLine = loc.end.line;
        }
      },
    };
  },
};
