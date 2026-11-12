import type { StopReason } from "@anthropic-ai/sdk/resources/messages";
import type { LogFields, Logger } from "@fpving/plugin-sdk";
import { anthropicMessages } from "../../../src/adapters/anthropic/llm-judge.ts";
import type { CreateMessage, MessageReply } from "../../../src/adapters/anthropic/llm-judge.ts";

export const textReply = (text: string, stopReason: StopReason = "end_turn"): MessageReply => ({
  content: [{ type: "text", text, citations: null }],
  stop_reason: stopReason,
  stop_details: null,
});

export const recordingLogger = (): { logger: Logger; logged: (LogFields | undefined)[] } => {
  const logged: (LogFields | undefined)[] = [];
  const record = (_message: string, fields?: LogFields): void => {
    logged.push(fields);
  };
  return { logger: { debug: record, info: record, warn: record, error: record }, logged };
};

export const keyedMessages = (
  apiKey: string,
  status: number,
  body: unknown,
): { createMessage: CreateMessage; sentHeaders: string[] } => {
  const sentHeaders: string[] = [];
  const createMessage = anthropicMessages({
    apiKey,
    maxRetries: 0,
    fetch: (_url, init) => {
      sentHeaders.push(JSON.stringify([...new Headers(init?.headers)]));
      const headers = { "content-type": "application/json" };
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
    },
  });
  return { createMessage, sentHeaders };
};
