import type { GearKind, Result } from "@fpving/plugin-sdk";
import type { LlmError } from "../ports/llm-judge.js";
import type { ReadSpecs, SpecReader } from "../ports/spec-reader.js";

/** A {@link SpecReader} that gives the same scripted answer to every call and records each text it was given. */
export class FakeSpecReader implements SpecReader {
  public readonly reads: { kind: GearKind; text: string }[] = [];

  public constructor(private readonly answer: Result<ReadSpecs, LlmError>) {}

  public async read(kind: GearKind, text: string): Promise<Result<ReadSpecs, LlmError>> {
    this.reads.push({ kind, text });
    return Promise.resolve(this.answer);
  }
}
