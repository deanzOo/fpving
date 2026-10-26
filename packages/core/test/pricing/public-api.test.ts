import { describe, expect, it } from "vitest";
import * as core from "../../src/index.ts";

describe("Core public pricing API", () => {
  it("exports the pricing functions and presets but keeps the rounding helper internal", () => {
    expect(Object.keys(core).sort()).toEqual([
      "COUNTRY_PRESETS",
      "ThresholdBasis",
      "convert",
      "err",
      "importTax",
      "landedCost",
      "ok",
    ]);
  });
});
