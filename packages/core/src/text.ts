import { z } from "zod";

/** A string with at least one character once trimmed, the form of every name, title and reason in core. */
export const textSchema = z.string().trim().min(1);
