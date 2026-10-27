import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matcherPairsSchema } from "../../eval/matcher-eval.ts";
import { LlmVerdict } from "../../src/index.ts";
import { similarity } from "../../src/matching/similarity.ts";

const PAIRS_FILE = new URL("../../eval/pairs.json", import.meta.url);
const HALF = 0.5;

const lowerMedian = (values: readonly number[]): number =>
  values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * HALF)] ?? 0;

describe("Title similarity", () => {
  it("scores a title holding every word of the reference as 1, however many other words it has", () => {
    expect(similarity("Tattu R-Line 1300mAh 6S", "Tattu R-Line 6S 1300mAh 120C LiPo Battery FPV Racing Drone XT60"))
      .toBe(1);
  });

  it("scores a title sharing nothing with the reference as 0", () => {
    expect(similarity("Tattu R-Line 1300mAh 6S", "Foxeer Lollipop antenna")).toBe(0);
  });

  it("scores texts without a single letter or digit as 0", () => {
    expect(similarity("---", "!!!")).toBe(0);
  });

  it("ignores case and the punctuation around words", () => {
    expect(similarity("Foxeer Lollipop 4", "foxeer, (LOLLIPOP) 4+")).toBe(1);
  });

  it("keeps a decimal like 5.8G as one word and joins hyphenated words, so R-Line matches RLine", () => {
    expect(similarity("5.8G R-Line", "RLine 5.8G")).toBe(1);
    expect(similarity("5.8G", "5 8G")).toBe(0);
    expect(similarity("R-Line 6S", "R Line 6S")).toBeLessThan(1);
  });

  it("ranks a title with the reference's model numbers above one sharing more words but other numbers", () => {
    const reference = "Tattu R-Line 1300mAh 6S";
    expect(similarity(reference, "1300mAh 6S Lipo")).toBeGreaterThan(similarity(reference, "Tattu R-Line 1550mAh 4S"));
  });

  it("scores a reference without model numbers on the share of its words found in the title", () => {
    expect(similarity("Foxeer Lollipop", "Foxeer antenna")).toBe(HALF);
  });

  it("scores the labelled same pairs higher than the different ones, by median", () => {
    const pairs = matcherPairsSchema.parse(JSON.parse(readFileSync(PAIRS_FILE, "utf8")));
    const scores = (label: string): number[] =>
      pairs.filter((pair) => pair.label === label).map((pair) => similarity(pair.source, pair.candidate));
    expect(lowerMedian(scores(LlmVerdict.Same))).toBeGreaterThan(lowerMedian(scores(LlmVerdict.Different)));
  });
});
