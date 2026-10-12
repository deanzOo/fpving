import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSpec, SpecReporter, type SpecModule } from "../../tools/spec-reporter.ts";

const test = (name: string) => ({ type: "test", name }) as const;
const suite = (name: string, children: SpecModule["children"]) => ({ type: "suite", name, children }) as const;

describe("renderSpec", () => {
  it("renders a suite as a heading with its tests as list items", () => {
    const md = renderSpec([{ children: [suite("Price drop alert", [test("fires when the price falls")])] }]);
    expect(md).toBe("## Price drop alert\n- fires when the price falls\n");
  });

  it("renders nested suites as deeper headings separated by blank lines", () => {
    const md = renderSpec([
      { children: [suite("Alerts", [test("exists"), suite("Price drop", [test("fires")])])] },
    ]);
    expect(md).toBe("## Alerts\n- exists\n\n### Price drop\n- fires\n");
  });

  it("renders module-level tests as bare list items", () => {
    expect(renderSpec([{ children: [test("works")] }])).toBe("- works\n");
  });

  it("separates consecutive suites and modules with blank lines", () => {
    const md = renderSpec([
      { children: [suite("A", [test("a1")])] },
      { children: [suite("B", [test("b1")])] },
    ]);
    expect(md).toBe("## A\n- a1\n\n## B\n- b1\n");
  });

  it("renders an empty run as an empty document", () => {
    expect(renderSpec([])).toBe("");
  });
});

describe("SpecReporter", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "spec-reporter-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the rendered spec to the configured file, creating directories", async () => {
    const file = join(dir, "reports", "spec.md");
    await new SpecReporter(file).onTestRunEnd([
      { children: [suite("Price drop alert", [test("fires when the price falls")])] },
    ]);
    expect(await readFile(file, "utf8")).toBe("## Price drop alert\n- fires when the price falls\n");
  });
});
