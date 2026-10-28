import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming, StopReason } from "@anthropic-ai/sdk/resources/messages";
import { LlmErrorKind, LlmVerdict, MATCHING_RULES } from "@fpving/core";
import type { LlmError, Result } from "@fpving/core";
import type { LogFields, Logger } from "@fpving/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_BASE_URL,
  anthropicMessages,
  createAnthropicLlmJudge,
  MATCHER_MODEL,
  MAX_IN_FLIGHT,
} from "../../../src/adapters/anthropic/llm-judge.ts";
import type { CreateMessage, MessageReply } from "../../../src/adapters/anthropic/llm-judge.ts";

const FAKE_KEY = "test-key-not-a-real-secret";
const SOURCE = "T-Motor F60 Pro V 2207 1950KV";
const CANDIDATE = "T-Motor F60 Pro V 2207 2550KV";
const VERDICT = { verdict: LlmVerdict.Variant, reason: "Only the KV differs" };
const IDENTITY = { brand: "T-Motor", model: "F60 Pro V", variantAttributes: ["2207", "1950KV"] };
const CALLS = MAX_IN_FLIGHT * MAX_IN_FLIGHT;
const Status = { BadRequest: 400, Unauthorized: 401, TooManyRequests: 429, ServerError: 500 } as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

const textReply = (text: string, stopReason: StopReason = "end_turn"): MessageReply => ({
  content: [{ type: "text", text, citations: null }],
  stop_reason: stopReason,
  stop_details: null,
});

const reply = (output: unknown, stopReason?: StopReason): MessageReply => textReply(JSON.stringify(output), stopReason);

const recordingLogger = (): { logger: Logger; logged: (LogFields | undefined)[] } => {
  const logged: (LogFields | undefined)[] = [];
  const record = (_message: string, fields?: LogFields): void => {
    logged.push(fields);
  };
  return { logger: { debug: record, info: record, warn: record, error: record }, logged };
};

const judgeReplying = (answer: () => Promise<MessageReply> | MessageReply) => {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const { logger, logged } = recordingLogger();
  const createMessage: CreateMessage = async (params) => {
    requests.push(params);
    return answer();
  };
  return { judge: createAnthropicLlmJudge(createMessage, logger), requests, logged };
};

const failure = (result: Result<unknown, LlmError>): LlmError | undefined => (result.ok ? undefined : result.error);

const userText = (request: MessageCreateParamsNonStreaming | undefined): string => JSON.stringify(request?.messages);

describe("Anthropic LLM judge", () => {
  it("compares two titles with the cheap model at low effort under a json schema and returns the verdict", async () => {
    const { judge, requests, logged } = judgeReplying(() => reply(VERDICT));
    expect(await judge.compare(SOURCE, CANDIDATE)).toEqual({ ok: true, value: VERDICT });
    const [request] = requests;
    expect(request).toMatchObject({ model: MATCHER_MODEL, output_config: { effort: "low" } });
    expect(request?.output_config?.format?.type).toBe("json_schema");
    expect(request).not.toHaveProperty("thinking");
    expect(userText(request)).toContain(SOURCE);
    expect(userText(request)).toContain(CANDIDATE);
    expect(logged).toEqual([]);
  });

  it("judges by every core matching rule", async () => {
    const { judge, requests } = judgeReplying(() => reply(VERDICT));
    await judge.compare(SOURCE, CANDIDATE);
    for (const rule of MATCHING_RULES) {
      expect(requests[0]?.system).toContain(rule);
    }
  });

  it("extracts the brand, model and variant attributes of a title", async () => {
    const { judge, requests } = judgeReplying(() => reply(IDENTITY));
    expect(await judge.extractIdentity(SOURCE)).toEqual({ ok: true, value: IDENTITY });
    expect(requests[0]).toMatchObject({ model: MATCHER_MODEL, output_config: { effort: "low" } });
    expect(userText(requests[0])).toContain(SOURCE);
  });

  it("sends the same request for the same titles so the prompt stays cacheable", async () => {
    const { judge, requests } = judgeReplying(() => reply(VERDICT));
    await judge.compare(SOURCE, CANDIDATE);
    await judge.compare(SOURCE, CANDIDATE);
    expect(JSON.stringify(requests[0])).toBe(JSON.stringify(requests[1]));
  });

  it("reports a refusal as unavailable, naming its category, and logs it", async () => {
    const { judge, logged } = judgeReplying(() => ({
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms", explanation: null },
    }));
    const error = failure(await judge.compare(SOURCE, CANDIDATE));
    expect(error?.kind).toBe(LlmErrorKind.Unavailable);
    expect(error?.detail).toContain("general_harms");
    expect(logged).toEqual([{ method: "compare", ...error }]);
  });

  it("reports a refusal without a category as unavailable", async () => {
    const { judge } = judgeReplying(() => ({ content: [], stop_reason: "refusal", stop_details: null }));
    expect(failure(await judge.extractIdentity(SOURCE))?.kind).toBe(LlmErrorKind.Unavailable);
  });

  it("reports an answer cut off at max tokens as malformed output", async () => {
    const { judge, logged } = judgeReplying(() => reply(VERDICT, "max_tokens"));
    const error = failure(await judge.compare(SOURCE, CANDIDATE));
    expect(error?.kind).toBe(LlmErrorKind.MalformedOutput);
    expect(error?.detail).toContain("max_tokens");
    expect(logged).toEqual([{ method: "compare", ...error }]);
  });

  it.each([
    ["a verdict outside the schema", reply({ verdict: "maybe", reason: "unsure" })],
    ["text that is not json", textReply("same")],
    ["no text at all", { content: [], stop_reason: "end_turn", stop_details: null }],
  ] satisfies [string, MessageReply][])("reports %s as malformed invalid output and logs it", async (_, answer) => {
    const { judge, logged } = judgeReplying(() => answer);
    const error = failure(await judge.compare(SOURCE, CANDIDATE));
    expect(error?.kind).toBe(LlmErrorKind.MalformedOutput);
    expect(error?.detail).toMatch(/^invalid output: /v);
    expect(logged).toEqual([{ method: "compare", ...error }]);
  });

  it.each([
    ["rate limited", new Anthropic.RateLimitError(Status.TooManyRequests, undefined, "slow down", new Headers())],
    ["authentication failed", new Anthropic.AuthenticationError(Status.Unauthorized, undefined, "bad", new Headers())],
    ["request rejected", new Anthropic.BadRequestError(Status.BadRequest, undefined, "bad request", new Headers())],
    ["connection failed", new Anthropic.APIConnectionError({ message: "offline" })],
    ["api error", new Anthropic.InternalServerError(Status.ServerError, undefined, "overloaded", new Headers())],
    ["unexpected failure", new TypeError("bug")],
  ])("reports a call that fails as %s as unavailable and logs it", async (label, thrown) => {
    const { judge, logged } = judgeReplying(() => Promise.reject(thrown));
    const error = failure(await judge.extractIdentity(SOURCE));
    expect(error?.kind).toBe(LlmErrorKind.Unavailable);
    expect(error?.detail).toContain(label);
    expect(logged).toEqual([{ method: "extractIdentity", ...error }]);
  });

  it(`keeps at most ${String(MAX_IN_FLIGHT)} calls in flight`, async () => {
    let inFlight = 0;
    let peak = 0;
    const { judge, requests } = judgeReplying(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return reply(VERDICT);
    });
    await Promise.all(Array.from({ length: CALLS }, async () => judge.compare(SOURCE, CANDIDATE)));
    expect(requests).toHaveLength(CALLS);
    expect(peak).toBe(MAX_IN_FLIGHT);
  });

  it("sends the key to the Anthropic API even when the shell sets ANTHROPIC_BASE_URL", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9");
    const urls: string[] = [];
    const createMessage = anthropicMessages({
      apiKey: FAKE_KEY,
      maxRetries: 0,
      fetch: (url) => {
        urls.push(new Request(url).url);
        return Promise.resolve(new Response("{}", { status: Status.Unauthorized }));
      },
    });
    await createAnthropicLlmJudge(createMessage, recordingLogger().logger).compare(SOURCE, CANDIDATE);
    expect(urls).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
  });

  it("calls the real client without ever logging the api key", async () => {
    const sentHeaders: string[] = [];
    const body = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
    const createMessage = anthropicMessages({
      apiKey: FAKE_KEY,
      maxRetries: 0,
      fetch: (_url, init) => {
        sentHeaders.push(JSON.stringify([...new Headers(init?.headers)]));
        const headers = { "content-type": "application/json" };
        return Promise.resolve(new Response(JSON.stringify(body), { status: Status.Unauthorized, headers }));
      },
    });
    const { logger, logged } = recordingLogger();
    const judge = createAnthropicLlmJudge(createMessage, logger);
    expect(failure(await judge.compare(SOURCE, CANDIDATE))?.detail).toContain("authentication failed");
    expect(sentHeaders.join()).toContain(FAKE_KEY);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(FAKE_KEY);
  });
});
