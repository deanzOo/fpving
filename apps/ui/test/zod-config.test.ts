import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../src/zod-config.ts";

describe("Zod in the page", () => {
  it("never compiles validators with eval, which the content security policy forbids", () => {
    expect(z.config().jitless).toBe(true);
  });
});
