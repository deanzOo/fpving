import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "../src/version.ts";

const packageVersion = (): unknown => {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return typeof parsed === "object" && parsed !== null && "version" in parsed ? parsed.version : undefined;
};

describe("SDK version", () => {
  it("equals the version in the plugin SDK package.json, so a release bump needs no second edit", () => {
    expect(SDK_VERSION).toBe(packageVersion());
  });
});
