import type { Rule } from "eslint";

export const maxOneLineComment: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      block: "Block comments are not allowed; use a single // line or JSDoc.",
      multi: "Comments must be a single line.",
    },
  },
  create(context) {
    return {
      Program() {
        let previousLine: number | undefined;
        for (const comment of context.sourceCode.getAllComments()) {
          const loc = comment.loc;
          if (!loc) continue;
          if (comment.type === "Block") {
            if (!comment.value.startsWith("*")) context.report({ loc, messageId: "block" });
            previousLine = undefined;
            continue;
          }
          if (previousLine !== undefined && loc.start.line === previousLine + 1) context.report({ loc, messageId: "multi" });
          previousLine = loc.end.line;
        }
      },
    };
  },
};
