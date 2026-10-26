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
  it("renders a module as a heading with its suites one level deeper", () => {
    const md = renderSpec([module([suite("Price drop alert", [test("fires when the price falls")])])]);
    expect(md).toBe("## core: test/a.test.ts\n\n### Price drop alert\n- fires when the price falls\n");
  });

  it("renders nested suites as deeper headings separated by blank lines", () => {
    const md = renderSpec([module([suite("Alerts", [test("exists"), suite("Price drop", [test("fires")])])])]);
    expect(md).toBe("## core: test/a.test.ts\n\n### Alerts\n- exists\n\n#### Price drop\n- fires\n");
  });

  it("keeps module-level tests under their own module heading, not the previous file's suite", () => {
    const md = renderSpec([
      module([suite("A", [test("a1")])], "test/a.test.ts"),
      module([test("top level")], "test/b.test.ts"),
    ]);
    expect(md).toBe("## core: test/a.test.ts\n\n### A\n- a1\n\n## core: test/b.test.ts\n- top level\n");
  });

  it("names the project in each module heading", () => {
    const md = renderSpec([module([test("works")], "test/result.test.ts", "plugin-sdk")]);
    expect(md).toBe("## plugin-sdk: test/result.test.ts\n- works\n");
  });

  it.each(["core", "plugin-sdk", "app"])("includes the %s product project", (project) => {
    expect(renderSpec([module([test("works")], "test/a.test.ts", project)])).toContain(`## ${project}:`);
  });

  it("leaves out the tooling project", () => {
    expect(renderSpec([module([test("lints")], "tests/tooling/a.test.ts", "tooling")])).toBe("");
  });

  it("leaves out skipped and todo tests", () => {
    const md = renderSpec([module([test("runs"), test("skipped", "skipped")])]);
    expect(md).toBe("## core: test/a.test.ts\n- runs\n");
  });

  it("drops suites and modules that hold only skipped tests", () => {
    const md = renderSpec([
      module([suite("Hidden", [test("skipped", "skipped"), suite("Nested", [test("also", "skipped")])])]),
      module([test("skipped", "skipped")], "test/b.test.ts"),
    ]);
    expect(md).toBe("");
  });

  it("keeps failed tests, which still describe intended behaviour", () => {
    expect(renderSpec([module([test("broken", "failed")])])).toContain("- broken");
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
      "## core: test/a.test.ts\n\n### Price drop alert\n- fires when the price falls\n",
    );
  });
});
