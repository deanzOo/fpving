import { defineConfig } from "vitest/config";
import type { TestProjectConfiguration } from "vitest/config";
import root from "./vitest.config.ts";

const MUTATED_PROJECTS: ReadonlySet<unknown> = new Set(["core", "plugin-sdk"]);

const isMutated = (project: TestProjectConfiguration): boolean =>
  typeof project === "object" && "test" in project && MUTATED_PROJECTS.has(project.test.name);

export default defineConfig({
  ...root,
  test: { ...root.test, projects: (root.test?.projects ?? []).filter(isMutated) },
});
