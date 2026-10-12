import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Reporter } from "vitest/node";

export interface SpecTest {
  readonly type: "test";
  readonly name: string;
}

export interface SpecSuite {
  readonly type: "suite";
  readonly name: string;
  readonly children: Iterable<SpecTest | SpecSuite>;
}

export interface SpecModule {
  readonly children: Iterable<SpecTest | SpecSuite>;
}

const FIRST_HEADING_LEVEL = 2;

const renderNodes = (nodes: Iterable<SpecTest | SpecSuite>, level: number, lines: string[]): void => {
  for (const node of nodes) {
    if (node.type === "test") {
      lines.push(`- ${node.name}`);
      continue;
    }
    if (lines.length > 0) lines.push("");
    lines.push(`${"#".repeat(level)} ${node.name}`);
    renderNodes(node.children, level + 1, lines);
  }
};

export const renderSpec = (modules: readonly SpecModule[]): string => {
  const lines: string[] = [];
  for (const module of modules) renderNodes(module.children, FIRST_HEADING_LEVEL, lines);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
};

export class SpecReporter implements Reporter {
  readonly #file: string;

  constructor(file = "reports/spec.md") {
    this.#file = file;
  }

  async onTestRunEnd(modules: readonly SpecModule[]): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    await writeFile(this.#file, renderSpec(modules));
  }
}
