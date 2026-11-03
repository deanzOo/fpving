import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import tokens from "../design/tokens.json" with { type: "json" };
import "../src/styles.css";

const SIZE = "13px";
const STYLES = tokens.type.groups.flatMap(({ family, styles }) => styles.map((style) => ({ ...style, family })));

describe("Type faces", () => {
  it.each(["400", "500", "600"])("bundles IBM Plex Sans at weight %s with the app", async (weight) => {
    const faces = await document.fonts.load(`${weight} ${SIZE} "IBM Plex Sans"`, "0");
    expect(faces.map((face) => face.weight)).toEqual([weight]);
  });

  it("bundles Martian Mono with its weight and width axes, so 87.5% narrows it", async () => {
    const [face] = await document.fonts.load(`400 ${SIZE} "Martian Mono"`, "0");
    expect(face?.family).toBe("Martian Mono");
    expect(face?.weight).toBe("100 800");
    expect(face?.stretch).toBe("75% 112.5%");
  });
});

describe("Type styles", () => {
  it.each(STYLES)("sets $name in its face, size, line height and weight", async (style) => {
    const screen = await render(<span className={`type-${style.name}`}>{style.sample}</span>);
    const computed = getComputedStyle(screen.getByText(style.sample).element());
    expect(computed.fontFamily).toBe(tokens.type.families[style.family === "mono" ? "mono" : "sans"]);
    expect(computed.fontSize).toBe(style.fontSize);
    expect(computed.lineHeight).toBe(style.lineHeight);
    expect(computed.fontWeight).toBe(String(style.fontWeight));
  });

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

  it("sets the page's own text in the body style, so a screen needs no size of its own", () => {
    const style = getComputedStyle(document.body);
    expect(style.fontSize).toBe("14px");
    expect(style.lineHeight).toBe("20px");
  });
});
