import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSpecPage, renderSpecPage } from "../../tools/spec-to-docs.ts";

describe("renderSpecPage", () => {
  it("prefixes the spec with starlight frontmatter", () => {
    const page = renderSpecPage("## Alerts\n- fires\n");
    expect(page.startsWith("---\ntitle: Behaviour specification\n")).toBe(true);
    expect(page).toContain("\n---\n");
  });

  it("keeps the spec body verbatim after the frontmatter and generated-file note", () => {
    const body = "## Alerts\n- fires\n\n### Price drop\n- fires on a new low\n";
    expect(renderSpecPage(body).endsWith(`\n${body}`)).toBe(true);
  });

  it("states that the page is generated from test names", () => {
    expect(renderSpecPage("## A\n- b\n")).toContain("Generated from test names");
  });

  it("rejects an empty spec", () => {
    expect(() => renderSpecPage("")).toThrow("spec is empty");
  });
});

describe("generateSpecPage", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "spec-to-docs-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the rendered page to the output file, creating directories", async () => {
    const input = join(dir, "reports", "spec.md");
    const output = join(dir, "docs", "reference", "behaviour-spec.md");
    await mkdir(join(dir, "reports"));
    await writeFile(input, "## Alerts\n- fires\n");
    await generateSpecPage(input, output);
    expect(await readFile(output, "utf8")).toBe(renderSpecPage("## Alerts\n- fires\n"));
  });

  it("fails loudly and tells the caller to run the tests first when the spec is missing", async () => {
    const input = join(dir, "reports", "spec.md");
    await expect(generateSpecPage(input, join(dir, "out.md"))).rejects.toThrow(
      `${input} not found: run "pnpm test" to generate the behaviour spec before building the docs`,
    );
  });

  it("rethrows read errors other than a missing file", async () => {
    await expect(generateSpecPage(dir, join(dir, "out.md"))).rejects.toThrow(/EISDIR/);
  });
});
