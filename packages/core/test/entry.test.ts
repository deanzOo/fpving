import { describe, expect, it } from "vitest";
import * as testing from "../src/testing/index.ts";
import { importsReachableFrom } from "../../../tools/imports-reachable.ts";

describe("core entry points", () => {
  it("keeps vitest out of everything the main entry imports and confines it to the testing entry", () => {
    expect([...importsReachableFrom(new URL("../src/index.ts", import.meta.url))]).not.toContain("vitest");
    expect([...importsReachableFrom(new URL("../src/testing/index.ts", import.meta.url))]).toContain("vitest");
  });

  it("exports the repository contract suite from the testing entry", () => {
    expect(Object.keys(testing)).toEqual(["describeRepositoryContract"]);
  });
});
