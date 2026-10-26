import { describe, expect, it } from "vitest";
import { storeErrorSchema, StoreErrorKind } from "../src/errors.ts";

describe("store errors", () => {
  it("names the six error kinds of the plugin taxonomy", () => {
    expect(Object.values(StoreErrorKind)).toEqual([
      "not_found",
      "blocked",
      "parse_failed",
      "timeout",
      "network",
      "unsupported_ship_to",
    ]);
  });

  it.each(Object.values(StoreErrorKind))("accepts a %s error with a detail", (kind) => {
    expect(storeErrorSchema.parse({ kind, detail: "why" })).toEqual({ kind, detail: "why" });
  });

  it("keeps the raw page of a parse_failed error", () => {
    const error = { kind: StoreErrorKind.ParseFailed, detail: "no price element", rawPage: "<html></html>" };
    expect(storeErrorSchema.parse(error)).toEqual(error);
  });

  it("drops a raw page attached to any other kind", () => {
    expect(storeErrorSchema.parse({ kind: StoreErrorKind.Blocked, detail: "captcha", rawPage: "<html>" }))
      .toEqual({ kind: StoreErrorKind.Blocked, detail: "captcha" });
  });

  it("rejects an unknown kind", () => {
    expect(storeErrorSchema.safeParse({ kind: "exploded", detail: "why" }).success).toBe(false);
  });

  it("rejects an error without a detail", () => {
    expect(storeErrorSchema.safeParse({ kind: StoreErrorKind.NotFound }).success).toBe(false);
  });
});
