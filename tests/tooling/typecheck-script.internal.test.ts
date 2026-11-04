import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const manifestSchema = z.object({ scripts: z.object({ typecheck: z.string() }) });

describe("Typecheck script", () => {
  it("does not ask a build-mode run to skip emit, which composite project references refuse", async () => {
    const { scripts } = manifestSchema.parse(JSON.parse(await readFile("package.json", "utf8")));
    expect(scripts.typecheck).toBe("tsc -b");
  });
});
