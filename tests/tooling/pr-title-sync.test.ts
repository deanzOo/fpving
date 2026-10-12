import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { COMMIT_SCOPES, COMMIT_TYPES, SUBJECT_MAX } from "../../tools/commit-rules.ts";

const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/pr-title.yml", import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionInputs(): Record<string, unknown> {
  const workflow: unknown = parse(readFileSync(WORKFLOW, "utf8"));
  const jobs = isRecord(workflow) ? workflow["jobs"] : undefined;
  for (const job of isRecord(jobs) ? Object.values(jobs) : []) {
    const steps = isRecord(job) ? job["steps"] : undefined;
    for (const step of Array.isArray(steps) ? steps : []) {
      const uses = isRecord(step) ? step["uses"] : undefined;
      const inputs = isRecord(step) ? step["with"] : undefined;
      if (typeof uses === "string" && uses.startsWith("amannn/action-semantic-pull-request@") && isRecord(inputs)) {
        return inputs;
      }
    }
  }
  throw new Error("semantic pull request step not found");
}

function lines(value: unknown): string[] {
  return typeof value === "string" ? value.split("\n").filter((line) => line !== "") : [];
}

describe("pr title workflow", () => {
  it("allows exactly the commit types", () => {
    expect(lines(actionInputs()["types"])).toEqual([...COMMIT_TYPES]);
  });

  it("allows exactly the commit scopes", () => {
    expect(lines(actionInputs()["scopes"])).toEqual([...COMMIT_SCOPES]);
  });

  it("keeps the scope optional like commitlint", () => {
    expect(actionInputs()["requireScope"]).toBe(false);
  });

  it("enforces lowercase start, no trailing period and the subject limit", () => {
    const pattern = new RegExp(String(actionInputs()["subjectPattern"]));
    expect(pattern.test("add money type")).toBe(true);
    expect(pattern.test("Add money type")).toBe(false);
    expect(pattern.test("add money type.")).toBe(false);
    expect(pattern.test("a".repeat(SUBJECT_MAX))).toBe(true);
    expect(pattern.test("a".repeat(SUBJECT_MAX + 1))).toBe(false);
  });
});
