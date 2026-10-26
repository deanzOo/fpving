import type { LlmError, LlmJudge, ProductIdentity, Result, Verdict } from "../../src/index.ts";

/** An {@link LlmJudge} that gives the same scripted answers to every call. */
export const fakeLlmJudge = (answers: {
  identity: Result<ProductIdentity, LlmError>;
  verdict: Result<Verdict, LlmError>;
}): LlmJudge => ({
  extractIdentity: async () => Promise.resolve(answers.identity),
  compare: async () => Promise.resolve(answers.verdict),
});
