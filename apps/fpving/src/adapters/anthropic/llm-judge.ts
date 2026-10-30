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

/** Where the real client sends requests, fixed so a shell `ANTHROPIC_BASE_URL` cannot redirect the user's key. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * The {@link CreateMessage} of a real client, always on {@link ANTHROPIC_BASE_URL}. The client's own retries cover
 * 429 and 5xx replies.
 *
 * @param options - The client options, at least the API key.
 * @returns The function that sends a request through the client.
 */
export const anthropicMessages = (options: Omit<ClientOptions, "baseURL">): CreateMessage => {
  const client = new Anthropic({ ...options, baseURL: ANTHROPIC_BASE_URL });
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
      return failed(method, LlmErrorKind.MalformedOutput, `invalid output: ${String(error)}`);
    }
  };

  return {
    extractIdentity: async (title) => ask("extractIdentity", identityFormat, EXTRACT_SYSTEM, extractMessage(title)),
    compare: async (source, candidate) =>
      ask("compare", verdictFormat, COMPARE_SYSTEM, compareMessage(source, candidate)),
  };
};

/** The detail of every answer from {@link keylessLlmJudge}. */
export const NO_API_KEY = "no ANTHROPIC_API_KEY is set";

/**
 * The core {@link LlmJudge} the app uses when no API key is set. Every call is `unavailable` with {@link NO_API_KEY},
 * so matching saves its candidates `unjudged` the way core defines, and nothing is sent. Each call is logged at debug
 * level only, since the app logs the missing key once at startup.
 *
 * @param logger - Where calls are logged.
 * @returns The judge.
 */
export const keylessLlmJudge = (logger: Logger): LlmJudge => {
  const unavailable = (method: keyof LlmJudge): Result<never, LlmError> => {
    logger.debug("LLM judge skipped", { method });
    return err({ kind: LlmErrorKind.Unavailable, detail: NO_API_KEY });
  };
  return {
    extractIdentity: async () => Promise.resolve(unavailable("extractIdentity")),
    compare: async () => Promise.resolve(unavailable("compare")),
  };
};
