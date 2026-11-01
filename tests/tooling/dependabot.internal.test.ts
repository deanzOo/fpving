import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ACTIONS = ".github/actions";

describe("Dependabot", () => {
  it("watches every composite action's folder, so the actions they pin get updates", async () => {
    const config = await readFile(".github/dependabot.yml", "utf8");
    const listed = [...config.matchAll(/^\s+- (\/\S+)$/gmu)].map(([, folder]) => folder);
    const actions = (await readdir(ACTIONS, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => `/${ACTIONS}/${name}`);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((folder) => !listed.includes(folder))).toEqual([]);
  });
});
