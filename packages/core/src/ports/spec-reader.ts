import type { GearKind, GearSpecs, Result } from "@fpving/plugin-sdk";
import type { LlmError } from "./llm-judge.js";

/** What a spec reader found in a text: a name when one is stated, and the specs it could tell. */
export interface ReadSpecs {
  /** The name of the gear, or null when the text gives none. */
  readonly name: string | null;
  /** The specs found, of the requested kind. */
  readonly specs: GearSpecs;
}

/** Reads the specs of a piece of gear from pasted text. Resolves to a `Result` and never rejects. */
export interface SpecReader {
  /** Reads `text` as gear of `kind`. */
  read(kind: GearKind, text: string): Promise<Result<ReadSpecs, LlmError>>;
}
