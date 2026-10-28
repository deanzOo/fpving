import { readFile } from "node:fs/promises";
import { anthropicMessages, createAnthropicLlmJudge } from "../apps/fpving/src/adapters/anthropic/llm-judge.ts";
import { matcherEvalFileSchema } from "../packages/core/eval/matcher-eval.ts";
import { evaluateMatcher, MATCHER_EVAL_SKIPPED, matcherEvalKey } from "./matcher-eval.ts";

const apiKey = matcherEvalKey(process.env);
if (apiKey === null) {
  console.log(MATCHER_EVAL_SKIPPED);
} else {
  const file = matcherEvalFileSchema.parse(
    JSON.parse(await readFile(new URL("../packages/core/eval/pairs.json", import.meta.url), "utf8")),
  );
  const logger = { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  const judge = createAnthropicLlmJudge(anthropicMessages({ apiKey }), logger);
  const outcome = await evaluateMatcher(judge, file.pairs);
  console.log(outcome.lines.join("\n"));
  process.exitCode = outcome.passed ? 0 : 1;
}
