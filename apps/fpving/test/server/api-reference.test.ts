import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderApiReference, writeApiReference } from "../../src/server/api-reference.ts";
import { apiRoutes } from "../../src/server/api-routes.ts";

describe("HTTP API reference page", () => {
  it("has a section for every route with its summary", () => {
    const page = renderApiReference();
    for (const { method, url, summary } of Object.values(apiRoutes)) {
      expect(page).toContain(`## ${method} ${url}\n\n${summary}`);
    }
  });

  it("shows each request part and each answer's schema", () => {
    const page = renderApiReference();
    expect(page).toContain("#### Request body");
    expect(page).toContain("#### Request params");
    expect(page).toContain("#### Request querystring");
    expect(page).toContain("#### Response 201");
    expect(page).toContain("\"kind\": {");
  });

  it("describes dates as ISO date-time strings", () => {
    expect(renderApiReference()).toContain("\"format\": \"date-time\"");
  });

  it("writes the page with its frontmatter, creating the folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpving-api-doc-"));
    const output = join(root, "reference", "http-api.md");
    await writeApiReference(output);
    expect(readFileSync(output, "utf8")).toMatch(/^---\ntitle: HTTP API\n/u);
    rmSync(root, { recursive: true, force: true });
  });
});
