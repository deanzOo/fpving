import { describe, expect, it } from "vitest";
import { err, ok } from "../src/result.ts";

describe("Result", () => {
  it("wraps a success value as ok", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it("wraps a failure as err", () => {
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });
});
