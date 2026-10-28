import type { Result } from "@fpving/plugin-sdk";
import { z } from "zod";
import type { Verdict } from "../entities.js";
import { textSchema } from "../text.js";

/** What identifies a product independent of the store: `variantAttributes` such as `"6S"` or `"1300mAh"`. */
export const productIdentitySchema = z.object({
  brand: textSchema,
  model: textSchema,
  variantAttributes: z.array(textSchema),
});

/** A product identity as {@link productIdentitySchema} accepts it. */
export type ProductIdentity = z.infer<typeof productIdentitySchema>;

/** Why the LLM gave no answer: it could not be reached or no key is set, or its output failed validation. */
export const LlmErrorKind = { Unavailable: "unavailable", MalformedOutput: "malformed_output" } as const;

/** One of the {@link LlmErrorKind} values. */
export type LlmErrorKind = (typeof LlmErrorKind)[keyof typeof LlmErrorKind];

/** An LLM failure. Callers keep working without the LLM; `detail` is for logs. */
export interface LlmError {
  /** See {@link LlmErrorKind}. */
  readonly kind: LlmErrorKind;
  /** Human-readable reason, never a secret. */
  readonly detail: string;
}

/**
 * Judges listing titles with an LLM. Methods resolve to a `Result` and never reject.
 *
 * @remarks
 * The adapter limits concurrency and request rate itself, since core calls it for many candidates at once.
 * The adapter logs every failure with its `detail`; core only falls back to `unjudged` or the raw title.
 */
export interface LlmJudge {
  /** Extracts brand, model and variant attributes from a listing title. */
  extractIdentity(title: string): Promise<Result<ProductIdentity, LlmError>>;
  /** Judges whether the candidate title is the same item as the source title, a variant of it, or different. */
  compare(sourceTitle: string, candidateTitle: string): Promise<Result<Verdict, LlmError>>;
}
