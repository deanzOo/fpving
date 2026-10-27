import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Reporter } from "vitest/node";

export interface SpecTest {
  readonly type: "test";
  readonly name: string;
  result(): { readonly state: string };
}

export interface SpecSuite {
  readonly type: "suite";
  readonly name: string;
  readonly children: Iterable<SpecTest | SpecSuite>;
}

export interface SpecModule {
  readonly project: { readonly name: string };
  readonly relativeModuleId: string;
  readonly children: Iterable<SpecTest | SpecSuite>;
}

const PRODUCT_PROJECTS: readonly string[] = ["core", "plugin-sdk", "app"];
const SKIPPED = "skipped";
const MODULE_HEADING_LEVEL = 2;

const hasTests = (node: SpecTest | SpecSuite): boolean =>
  node.type === "test" ? node.result().state !== SKIPPED : [...node.children].some(hasTests);

const renderNodes = (nodes: Iterable<SpecTest | SpecSuite>, level: number, lines: string[]): void => {
  for (const node of nodes) {
    if (!hasTests(node)) continue;
    if (node.type === "test") {
      lines.push(`- ${node.name}`);
      continue;
    }
    lines.push("");
    lines.push(`${"#".repeat(level)} ${node.name}`);
    renderNodes(node.children, level + 1, lines);
  }
};

export const renderSpec = (modules: readonly SpecModule[]): string => {
  const lines: string[] = [];
  for (const module of modules) {
    if (!PRODUCT_PROJECTS.includes(module.project.name) || ![...module.children].some(hasTests)) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`${"#".repeat(MODULE_HEADING_LEVEL)} ${module.project.name}: ${module.relativeModuleId}`);
    renderNodes(module.children, MODULE_HEADING_LEVEL + 1, lines);
  }
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
