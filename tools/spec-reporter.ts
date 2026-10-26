import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
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

const PROJECT_TITLES = new Map([
  ["core", "Core"],
  ["plugin-sdk", "Plugin SDK"],
  ["app", "App"],
]);
const INTERNAL_SUFFIX = ".internal.test.ts";
const TEST_FILE_SUFFIX = /\.test\.ts$/;
const SKIPPED = "skipped";
const PROJECT_HEADING_LEVEL = 2;

const hasTests = (node: SpecTest | SpecSuite): boolean =>
  node.type === "test" ? node.result().state !== SKIPPED : [...node.children].some(hasTests);

const sentence = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

const fileTitle = (moduleId: string): string =>
  sentence(basename(moduleId).replace(TEST_FILE_SUFFIX, "").replaceAll("-", " "));

const heading = (level: number, title: string): string[] => ["", `${"#".repeat(level)} ${title}`];

const renderNodes = (nodes: Iterable<SpecTest | SpecSuite>, level: number, lines: string[]): void => {
  const present = [...nodes].filter(hasTests);
  for (const node of present) {
    if (node.type === "test") lines.push(`- ${node.name}`);
  }
  for (const node of present) {
    if (node.type !== "suite") continue;
    lines.push(...heading(level, node.name));
    renderNodes(node.children, level + 1, lines);
  }
};

const renderModule = (module: SpecModule, lines: string[]): void => {
  const level = PROJECT_HEADING_LEVEL + 1;
  const children = [...module.children].filter(hasTests);
  if (children.some((node) => node.type === "test")) {
    lines.push(...heading(level, fileTitle(module.relativeModuleId)));
    renderNodes(
      children.filter((node) => node.type === "test"),
      level + 1,
      lines,
    );
  }
  for (const node of children) {
    if (node.type !== "suite") continue;
    lines.push(...heading(level, node.name));
    renderNodes(node.children, level + 1, lines);
  }
};

export const renderSpec = (modules: readonly SpecModule[]): string => {
  const projects = new Map<string, string[]>();
  for (const module of modules) {
    const title = PROJECT_TITLES.get(module.project.name);
    if (title === undefined || module.relativeModuleId.endsWith(INTERNAL_SUFFIX)) continue;
    if (![...module.children].some(hasTests)) continue;
    const lines = projects.get(title) ?? heading(PROJECT_HEADING_LEVEL, title);
    renderModule(module, lines);
    projects.set(title, lines);
  }
  const lines = [...projects.values()].flat().slice(1);
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
