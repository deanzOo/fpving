import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { err, LlmErrorKind } from "@fpving/core";
import type { Logger, ReadSpecs, SpecReader } from "@fpving/core";
import { GearKind, gearSpecsSchema } from "@fpving/plugin-sdk";
import { z } from "zod";
import { createAsk, NO_API_KEY } from "./llm-judge.js";
import type { CreateMessage } from "./llm-judge.js";
import { SPECS_SYSTEM, specsMessage } from "./prompt.js";

const NAME_FIELD = "name";
const KIND_FIELD = "kind";
const NAME = z.string().nullable();

const [RADIO, GOGGLES, QUAD, BATTERY, CHARGER, TOOL] = gearSpecsSchema.options;

const formatOf = (kind: GearKind, shape: Record<string, z.ZodExactOptional>) => {
  const fields = Object.entries(shape).map(([field, schema]) => [field, z.nullable(schema.unwrap()).catch(null)]);
  const output = z.object(Object.fromEntries(fields)).extend({ [NAME_FIELD]: NAME.catch(null) });
  const format = zodOutputFormat(output);
  const parse = (content: string): ReadSpecs => {
    const { [NAME_FIELD]: name, ...found } = format.parse(content);
    const known = Object.fromEntries(Object.entries(found).filter(([, value]) => value !== null));
    return { name: NAME.parse(name), specs: gearSpecsSchema.parse({ [KIND_FIELD]: kind, ...known }) };
  };
  return { ...format, parse };
};

const formats = {
  [GearKind.Radio]: formatOf(GearKind.Radio, RADIO.omit({ kind: true }).shape),
  [GearKind.Goggles]: formatOf(GearKind.Goggles, GOGGLES.omit({ kind: true }).shape),
  [GearKind.Quad]: formatOf(GearKind.Quad, QUAD.omit({ kind: true }).shape),
  [GearKind.Battery]: formatOf(GearKind.Battery, BATTERY.omit({ kind: true }).shape),
  [GearKind.Charger]: formatOf(GearKind.Charger, CHARGER.omit({ kind: true }).shape),
  [GearKind.Tool]: formatOf(GearKind.Tool, TOOL.omit({ kind: true }).shape),
};

/** Options of {@link createSpecReader}. */
export interface SpecReaderOptions {
  /** Sends a request, see `anthropicMessages`. */
  readonly createMessage: CreateMessage;
  /** Where failures are logged. */
  readonly logger: Logger;
}

/**
 * Creates the core {@link SpecReader} on the Anthropic Messages API. The model answers every spec field or null;
 * a field outside the shared vocabulary is dropped and the rest are kept.
 *
 * @param options - See {@link SpecReaderOptions}.
 * @returns The reader.
 */
export const createSpecReader = (options: SpecReaderOptions): SpecReader => {
  const ask = createAsk(options.createMessage, options.logger);
  return {
    read: async (kind, text) =>
      ask("readSpecs", formats[kind], SPECS_SYSTEM, specsMessage(kind, text)),
  };
};

/**
 * The core {@link SpecReader} the app uses when no API key is set. Every call is `unavailable` with {@link NO_API_KEY}
 * and nothing is sent.
 *
 * @param logger - Where calls are logged, at debug level.
 * @returns The reader.
 */
export const keylessSpecReader = (logger: Logger): SpecReader => ({
  read: async () => {
    logger.debug("Spec reader skipped", { method: "readSpecs" });
    return Promise.resolve(err({ kind: LlmErrorKind.Unavailable, detail: NO_API_KEY }));
  },
});
