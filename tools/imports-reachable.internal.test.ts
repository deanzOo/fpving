import { describe, expect, it } from "vitest";
import { importsReachableFrom } from "./imports-reachable.ts";

describe("Reachable imports", () => {
  it("follows side-effect, single-quoted, type-only and dynamic imports", () => {
    const reached = importsReachableFrom(new URL("../tests/tooling/fixtures/imports/entry.ts", import.meta.url));
    expect([...reached].filter((specifier) => !specifier.startsWith("file:")).sort()).toEqual([
      "dynamic-pkg",
      "side-effect-pkg",
      "single-pkg",
      "typed-pkg",
    ]);
  });
});
