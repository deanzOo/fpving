import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const CONFIG = "release-please-config.json";
const FIRST_VERSION = "0.1.0";

describe("Release-please config", () => {
  it("makes the first release 0.1.0 instead of its default 1.0.0", async () => {
    const config: unknown = JSON.parse(await readFile(CONFIG, "utf8"));
    expect(config).toMatchObject({ "initial-version": FIRST_VERSION });
  });
});
