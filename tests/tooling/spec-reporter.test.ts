import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSpec, SpecReporter, type SpecModule } from "../../tools/spec-reporter.ts";

const test = (name: string, state = "passed") => ({ type: "test", name, result: () => ({ state }) }) as const;
const suite = (name: string, children: SpecModule["children"]) => ({ type: "suite", name, children }) as const;
const module = (children: SpecModule["children"], file = "test/a.test.ts", project = "core"): SpecModule => ({
  project: { name: project },
  relativeModuleId: file,
  children,
});

describe("renderSpec", () => {
  it("renders a project as a title with its suites one level deeper", () => {
    const md = renderSpec([module([suite("Price drop alert", [test("fires when the price falls")])])]);
    expect(md).toBe("## Core\n\n### Price drop alert\n- fires when the price falls\n");
  });

  it("renders nested suites as deeper headings separated by blank lines", () => {
    const md = renderSpec([module([suite("Alerts", [test("exists"), suite("Price drop", [test("fires")])])])]);
    expect(md).toBe("## Core\n\n### Alerts\n- exists\n\n#### Price drop\n- fires\n");
  });

  it("lists a suite's own tests before its nested suites, so none reads as belonging to a nested heading", () => {
    const md = renderSpec([module([suite("Alerts", [suite("Nested", [test("inner")]), test("outer")])])]);
    expect(md).toBe("## Core\n\n### Alerts\n- outer\n\n#### Nested\n- inner\n");
  });

  it("gathers the modules of one project under a single title", () => {
    const md = renderSpec([module([suite("A", [test("a1")])]), module([suite("B", [test("b1")])], "test/b.test.ts")]);
    expect(md).toBe("## Core\n\n### A\n- a1\n\n### B\n- b1\n");
  });

  it("titles module-level tests after their file, not its path", () => {
    const md = renderSpec([module([test("top level")], "test/import-tax.test.ts")]);
    expect(md).toBe("## Core\n\n### Import tax\n- top level\n");
  });

  it.each([
    ["core", "Core"],
    ["plugin-sdk", "Plugin SDK"],
    ["app", "App"],
  ])("titles the %s product project %s", (project, title) => {
    expect(renderSpec([module([test("works")], "test/a.test.ts", project)])).toContain(`## ${title}\n`);
  });

  it("leaves out the tooling project", () => {
    expect(renderSpec([module([test("lints")], "tests/tooling/a.test.ts", "tooling")])).toBe("");
  });

  it("leaves out implementation-detail modules named .internal.test.ts", () => {
    const md = renderSpec([
      module([suite("Test fakes", [test("count")])], "test/fakes.internal.test.ts"),
      module([suite("Pricing", [test("rounds")])], "test/pricing/money.test.ts"),
    ]);
    expect(md).toBe("## Core\n\n### Pricing\n- rounds\n");
  });

  it("leaves out skipped and todo tests", () => {
    const md = renderSpec([module([suite("A", [test("runs"), test("skipped", "skipped")])])]);
    expect(md).toBe("## Core\n\n### A\n- runs\n");
  });

  it("drops suites and modules that hold only skipped tests", () => {
    const md = renderSpec([
      module([suite("Hidden", [test("skipped", "skipped"), suite("Nested", [test("also", "skipped")])])]),
      module([test("skipped", "skipped")], "test/b.test.ts"),
    ]);
    expect(md).toBe("");
  });

  it("keeps failed tests, which still describe intended behaviour", () => {
    expect(renderSpec([module([suite("A", [test("broken", "failed")])])])).toContain("- broken");
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
    const children = [suite("Price drop alert", [test("fires when the price falls")])];
    await new SpecReporter(file).onTestRunEnd([module(children)]);
    expect(await readFile(file, "utf8")).toBe(
      "## Core\n\n### Price drop alert\n- fires when the price falls\n",
    );
  });
});
