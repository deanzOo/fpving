import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import "../src/styles.css";

const SIZE = "13px";

describe("Type faces", () => {
  it.each([
    ["IBM Plex Sans", "400"],
    ["IBM Plex Sans", "500"],
    ["IBM Plex Sans", "600"],
    ["Martian Mono", "400"],
    ["Martian Mono", "500"],
  ])("bundles %s at weight %s with the app", async (family, weight) => {
    const faces = await document.fonts.load(`${weight} ${SIZE} "${family}"`, "0");
    expect(faces.map((face) => face.family.replaceAll("\"", ""))).toContain(family);
  });

  it("loads the mono face with its width axis, so 87.5% narrows it", async () => {
    const [face] = await document.fonts.load(`400 ${SIZE} "Martian Mono"`, "0");
    expect(face?.stretch).toBe("75% 112.5%");
  });
});

describe("Type styles", () => {
  it("sets readouts in the narrowed mono face with tabular, slashed-zero figures", async () => {
    const screen = await render(<span className="type-readout">€42.15</span>);
    const style = getComputedStyle(screen.getByText("€42.15").element());
    expect(style.fontFamily).toContain("Martian Mono");
    expect(style.fontStretch).toBe("87.5%");
    expect(style.fontVariantNumeric).toBe("tabular-nums slashed-zero");
  });

  it("sets labels uppercase and tracked", async () => {
    const screen = await render(<span className="type-label">Landed cost</span>);
    const style = getComputedStyle(screen.getByText("Landed cost").element());
    expect(style.textTransform).toBe("uppercase");
    expect(style.fontSize).toBe("11px");
  });

  it("sets sentences in the sans face", async () => {
    const screen = await render(<p className="type-body">Nothing is watched yet.</p>);
    const style = getComputedStyle(screen.getByText("Nothing is watched yet.").element());
    expect(style.fontFamily).toContain("IBM Plex Sans");
    expect(style.lineHeight).toBe("20px");
  });
});
