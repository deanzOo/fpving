import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { LlmErrorKind } from "@fpving/core";
import { GearKind, RadioFirmware, RcLink } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MATCHER_MODEL, NO_API_KEY } from "../../../src/adapters/anthropic/llm-judge.ts";
import type { CreateMessage } from "../../../src/adapters/anthropic/llm-judge.ts";
import { createSpecReader, keylessSpecReader } from "../../../src/adapters/anthropic/spec-reader.ts";
import { keyedMessages, recordingLogger, textReply } from "./helpers.ts";

const FAKE_KEY = "test-key-not-a-real-secret";
const PASTE = "RadioMaster Boxer, ExpressLRS 2.4GHz built in, runs EdgeTX";
const CELLS = 4;
const OK = 200;

const readerReplying = (text: string) => {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const { logger, logged } = recordingLogger();
  const createMessage: CreateMessage = (params) => {
    requests.push(params);
    return Promise.resolve(textReply(text));
  };
  return { reader: createSpecReader({ createMessage, logger }), requests, logged };
};

describe("Spec reader", () => {
  it("reads the radio link and firmware from pasted specs", async () => {
    const { reader, requests } = readerReplying(
      JSON.stringify({ name: "RadioMaster Boxer", rcLink: RcLink.Elrs2g4, firmware: RadioFirmware.EdgeTx }),
    );
    expect(await reader.read(GearKind.Radio, PASTE)).toEqual({
      ok: true,
      value: {
        name: "RadioMaster Boxer",
        specs: { kind: GearKind.Radio, rcLink: RcLink.Elrs2g4, firmware: RadioFirmware.EdgeTx },
      },
    });
    expect(requests[0]).toMatchObject({ model: MATCHER_MODEL });
    expect(JSON.stringify(requests[0]?.messages)).toContain(PASTE);
    expect(requests[0]?.output_config?.format?.type).toBe("json_schema");
  });

  it("drops a value outside the vocabulary and keeps the other fields", async () => {
    const { reader } = readerReplying(
      JSON.stringify({ name: null, rcLink: "wifi", firmware: RadioFirmware.EdgeTx, invented: 1 }),
    );
    expect(await reader.read(GearKind.Radio, PASTE)).toEqual({
      ok: true,
      value: { name: null, specs: { kind: GearKind.Radio, firmware: RadioFirmware.EdgeTx } },
    });
  });

  it("leaves nulls, bad numbers and bad lists unknown", async () => {
    const bad = { name: "X", cells: [CELLS, CELLS], connectors: ["xt60", "bad"], ports: 0 };
    const { reader } = readerReplying(JSON.stringify(bad));
    expect(await reader.read(GearKind.Charger, PASTE)).toEqual({
      ok: true,
      value: { name: "X", specs: { kind: GearKind.Charger } },
    });
    const kept = readerReplying(JSON.stringify({ name: "X", cells: [CELLS], connectors: null, ports: 2 }));
    expect(await kept.reader.read(GearKind.Charger, PASTE)).toEqual({
      ok: true,
      value: { name: "X", specs: { kind: GearKind.Charger, cells: [CELLS], ports: 2 } },
    });
  });

  it("answers malformed output when the reply is not JSON, without leaking the key", async () => {
    const message = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: MATCHER_MODEL,
      content: [{ type: "text", text: "not json" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { createMessage, sentHeaders } = keyedMessages(FAKE_KEY, OK, message);
    const { logger, logged } = recordingLogger();
    const result = await createSpecReader({ createMessage, logger }).read(GearKind.Radio, PASTE);
    expect(result).toMatchObject({ ok: false, error: { kind: LlmErrorKind.MalformedOutput } });
    expect(sentHeaders.join()).toContain(FAKE_KEY);
    expect(logged).toHaveLength(1);
    for (const record of [result, ...logged]) {
      expect(JSON.stringify(record)).not.toContain(FAKE_KEY);
    }
  });

  it("asks for the name and every spec field of the kind, each nullable", async () => {
    const asked = new Map<string, string[]>();
    for (const kind of Object.values(GearKind)) {
      const { reader, requests } = readerReplying("{}");
      await reader.read(kind, PASTE);
      const format = requests[0]?.output_config?.format;
      const { properties } = z.object({ properties: z.record(z.string(), z.unknown()) }).parse(format?.schema);
      asked.set(kind, Object.keys(properties).toSorted());
      expect(JSON.stringify(properties)).toContain("null");
      expect(JSON.stringify(properties)).toContain(kind === GearKind.Radio ? RcLink.Elrs2g4 : "null");
    }
    expect(Object.fromEntries(asked)).toEqual({
      radio: ["firmware", "name", "rcLink"],
      goggles: ["channels", "name", "videoSystems"],
      quad: ["cells", "connector", "name", "rcLink", "sizeClass", "videoSystem"],
      battery: ["capacityMah", "cells", "chemistry", "connector", "name"],
      charger: ["cells", "connectors", "name", "ports"],
      tool: ["name", "toolType"],
    });
  });

  it("answers unavailable when the request fails", async () => {
    const { logger } = recordingLogger();
    const reader = createSpecReader({
      createMessage: () => Promise.reject(new Error("down")),
      logger,
    });
    expect(await reader.read(GearKind.Tool, PASTE)).toMatchObject({
      ok: false,
      error: { kind: LlmErrorKind.Unavailable },
    });
  });

  it("answers unavailable without a key", async () => {
    const { logger, logged } = recordingLogger();
    const reader = keylessSpecReader(logger);
    expect(await reader.read(GearKind.Radio, PASTE)).toEqual({
      ok: false,
      error: { kind: LlmErrorKind.Unavailable, detail: NO_API_KEY },
    });
    expect(logged).toEqual([{ method: "readSpecs" }]);
  });
});
