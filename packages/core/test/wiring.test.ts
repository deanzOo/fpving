import { describe, expect, it } from "vitest";
import { err, ok } from "../src/index.ts";

describe("cross-package wiring", () => {
  it("re-exports the plugin-sdk Result helpers from core without a prior build", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });
});
