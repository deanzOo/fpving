import Anthropic from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { err, LlmErrorKind, ok, productIdentitySchema, verdictSchema } from "@fpving/core";
import type { LlmError, LlmJudge, Logger, Result } from "@fpving/core";
import type { z } from "zod";
import { limitConcurrency } from "./limit.js";
import { COMPARE_SYSTEM, compareMessage, EXTRACT_SYSTEM, extractMessage } from "./prompt.js";

/** The cheap Haiku model the matcher judges with. */
export const MATCHER_MODEL = "claude-haiku-5-5";

/** How many calls the judge keeps in flight at once. */
export const MAX_IN_FLIGHT = 4;

const MAX_TOKENS = 1024;

/** The parts of a Messages API reply the judge reads. */
export type MessageReply = Pick<Message, "content" | "stop_reason" | "stop_details">;

/** Sends one non-streaming Messages API request. */
export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<MessageReply>;

/**
 * The {@link CreateMessage} of a real client. The client's own retries cover 429 and 5xx replies.
 *
 * @param options - The client options, at least the API key.
 * @returns The function that sends a request through the client.
 */
export const anthropicMessages = (options: ClientOptions): CreateMessage => {
  const client = new Anthropic(options);
  return async (params) => client.messages.create(params);
};

const API_FAILURES = [
  [Anthropic.RateLimitError, "rate limited"],
  [Anthropic.AuthenticationError, "authentication failed"],
  [Anthropic.BadRequestError, "request rejected"],
  [Anthropic.APIConnectionError, "connection failed"],
  [Anthropic.APIError, "api error"],
] as const;

const describeFailure = (error: unknown): string => {
  const label = API_FAILURES.find(([type]) => error instanceof type)?.[1] ?? "unexpected failure";
  return `${label}: ${String(error)}`;
};

const identityFormat = zodOutputFormat(productIdentitySchema);
const verdictFormat = zodOutputFormat(verdictSchema);

type Format<T> = ReturnType<typeof zodOutputFormat<z.ZodType<T>>>;

/**
 * Creates the core {@link LlmJudge} on the Anthropic Messages API. It keeps at most {@link MAX_IN_FLIGHT} calls in
 * flight and logs every failure as a warning with its kind and detail.
 *
 * @param createMessage - Sends a request, see {@link anthropicMessages}.
 * @param logger - Where failures are logged.
 * @returns The judge.
 */
export const createAnthropicLlmJudge = (createMessage: CreateMessage, logger: Logger): LlmJudge => {
  const limit = limitConcurrency(MAX_IN_FLIGHT);

  const failed = (method: keyof LlmJudge, kind: LlmErrorKind, detail: string): Result<never, LlmError> => {
    logger.warn("LLM judge call failed", { method, kind, detail });
    return err({ kind, detail });
  };

  const ask = async <T>(method: keyof LlmJudge, format: Format<T>, system: string, text: string) => {
    let reply: MessageReply;
    try {
      reply = await limit(async () => createMessage({
        model: MATCHER_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: text }],
        output_config: { effort: "low", format },
      }));
    } catch (error) {
      return failed(method, LlmErrorKind.Unavailable, describeFailure(error));
    }
    if (reply.stop_reason === "refusal") {
      return failed(method, LlmErrorKind.Unavailable, `refused: ${reply.stop_details?.category ?? "no category"}`);
    }
    if (reply.stop_reason !== "end_turn") {
      return failed(method, LlmErrorKind.MalformedOutput, `stopped at ${String(reply.stop_reason)}`);
    }
    const answer = reply.content.find((block) => block.type === "text")?.text ?? "";
    try {
      return ok(format.parse(answer));
    } catch (error) {
      return failed(method, LlmErrorKind.MalformedOutput, describeFailure(error));
    }
  };

  return {
    extractIdentity: async (title) => ask("extractIdentity", identityFormat, EXTRACT_SYSTEM, extractMessage(title)),
    compare: async (source, candidate) =>
      ask("compare", verdictFormat, COMPARE_SYSTEM, compareMessage(source, candidate)),
  };
};
