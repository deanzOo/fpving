import type { Result } from "@fpving/plugin-sdk";
import type { Verdict } from "../entities.js";
import type { LlmError, LlmJudge, ProductIdentity } from "../ports/llm-judge.js";

/** An {@link LlmJudge} that gives the same scripted answers to every call and records each compared title pair. */
export const fakeLlmJudge = (answers: {
  identity: Result<ProductIdentity, LlmError>;
  verdict: Result<Verdict, LlmError>;
}): LlmJudge & { compared: [string, string][] } => {
  const compared: [string, string][] = [];
  return {
    compared,
    extractIdentity: async () => Promise.resolve(answers.identity),
    compare: async (sourceTitle, candidateTitle) => {
      compared.push([sourceTitle, candidateTitle]);
      return Promise.resolve(answers.verdict);
    },
  };
};
