import type { Rule, SourceCode } from "eslint";

type AnyNode = Parameters<SourceCode["getAncestors"]>[0];

const MEMBER_SELECTOR = [
  "TSPropertySignature",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSIndexSignature",
  "PropertyDefinition",
  "MethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractMethodDefinition",
  "TSEnumMember",
].join(", ");
const EXPORT_TYPES = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
const SCOPE_BOUNDARY_TYPES = new Set(["BlockStatement", "ArrowFunctionExpression", "FunctionExpression"]);

export const maxOneLineComment: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      block: "Block comments are not allowed; use a single // line or JSDoc on an export.",
      jsdoc: "JSDoc blocks are allowed only directly before an export or on a member of an exported declaration.",
      multi: "Comments must be a single line.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const exportedMemberStarts = new Set<number>();
    const isAttachedToExport = (comment: ReturnType<SourceCode["getAllComments"]>[number]): boolean => {
      const next = sourceCode.getTokenAfter(comment, { includeComments: true });
      if (next === null) return false;
      if (next.value === "export") return true;
      if (next.type === "Line" || next.type === "Block") return false;
      return exportedMemberStarts.has(sourceCode.getRange(next)[0]);
    };
    const blockViolation = (comment: ReturnType<SourceCode["getAllComments"]>[number]) => {
      const isDoc = comment.value.startsWith("*");
      const messageId = isDoc ? "jsdoc" : "block";
      return isDoc && isAttachedToExport(comment) ? undefined : messageId;
    };
    return {
      [MEMBER_SELECTOR](node: AnyNode) {
        const ancestors = sourceCode.getAncestors(node);
        if (ancestors.some((ancestor) => SCOPE_BOUNDARY_TYPES.has(ancestor.type))) return;
        if (ancestors.some((ancestor) => EXPORT_TYPES.has(ancestor.type))) {
          exportedMemberStarts.add(sourceCode.getRange(node)[0]);
        }
      },
      "Program:exit"() {
        let previousLine: number | undefined;
        for (const comment of sourceCode.getAllComments()) {
          const loc = sourceCode.getLoc(comment);
          if (comment.type === "Block") {
            const messageId = blockViolation(comment);
            if (messageId !== undefined) context.report({ loc, messageId });
            previousLine = undefined;
            continue;
          }
          const trailing = sourceCode.getTokenBefore(comment)?.loc.end.line === loc.start.line;
          if (!trailing && previousLine !== undefined && loc.start.line === previousLine + 1) {
            context.report({ loc, messageId: "multi" });
          }
          previousLine = loc.end.line;
        }
      },
    };
  },
};
