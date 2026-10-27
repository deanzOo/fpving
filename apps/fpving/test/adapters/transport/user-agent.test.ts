import { describe, expect, it } from "vitest";
import { createUserAgent, readAppVersion, REPO_URL } from "../../../src/adapters/transport/user-agent.ts";

describe("The fpving user agent", () => {
  it("names the app, its version and the repository", () => {
    expect(createUserAgent("1.2.3")).toBe(`fpving/1.2.3 (+${REPO_URL})`);
    expect(REPO_URL).toBe("https://github.com/deanzOo/fpving");
  });

  it("reads the version from the app package.json", () => {
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
