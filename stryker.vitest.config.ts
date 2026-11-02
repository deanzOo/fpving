import { defineConfig } from "vitest/config";
import type { TestProjectConfiguration } from "vitest/config";
import root from "./vitest.config.ts";

const MUTATED_PROJECTS: readonly string[] = ["core", "plugin-sdk"];

const isMutated = (project: TestProjectConfiguration): boolean =>
  typeof project === "object"
  && "test" in project
  && typeof project.test.name === "string"
  && MUTATED_PROJECTS.includes(project.test.name);

export default defineConfig({
  ...root,
  test: { ...root.test, reporters: [], projects: (root.test?.projects ?? []).filter(isMutated) },
});
