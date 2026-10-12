import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FRONTMATTER = [
  "---",
  "title: Behaviour specification",
  "description: What fpving does, read straight from the names of its tests.",
  "---",
  "",
  "Generated from test names on every docs build. Do not edit by hand.",
  "",
].join("\n");

export const renderSpecPage = (spec: string): string => {
  if (spec.trim() === "") throw new Error("spec is empty: the test run produced no behaviour spec");
  return `${FRONTMATTER}\n${spec}`;
};

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const generateSpecPage = async (input: string, output: string): Promise<void> => {
  let spec: string;
  try {
    spec = await readFile(input, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`${input} not found: run "pnpm test" to generate the behaviour spec before building the docs`, {
        cause: error,
      });
    }
    throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderSpecPage(spec));
};
