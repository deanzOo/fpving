import { readFile } from "node:fs/promises";
import { anthropicMessages, createAnthropicLlmJudge } from "../apps/fpving/src/adapters/anthropic/llm-judge.ts";
import { matcherEvalFileSchema } from "../packages/core/eval/matcher-eval.ts";
import { evaluateMatcher } from "./matcher-eval.ts";

const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
if (apiKey === "") {
  console.log("Matcher eval skipped: no ANTHROPIC_API_KEY.");
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
