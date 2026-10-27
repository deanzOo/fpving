import { describe, expect, it } from "vitest";
import { similarity } from "../../src/matching/similarity.ts";

describe("Title similarity", () => {
  it("scores a title holding every model number and word of the reference as 1", () => {
    expect(similarity("Tattu R-Line 1300mAh 6S", "tattu r line 6s 1300mah")).toBe(1);
  });

  it("scores a title sharing nothing with the reference as 0", () => {
    expect(similarity("Tattu R-Line 1300mAh 6S", "Foxeer Lollipop antenna")).toBe(0);
  });

  it("scores texts without a single letter or digit as 0", () => {
    expect(similarity("---", "!!!")).toBe(0);
  });

  it("ignores case and punctuation", () => {
    expect(similarity("T-Motor F60 Pro", "t motor, f60 (pro)")).toBe(1);
  });

  it("ranks a title with the reference's model numbers above one sharing more words but other numbers", () => {
    const reference = "Tattu R-Line 1300mAh 6S";
    expect(similarity(reference, "1300mAh 6S Lipo")).toBeGreaterThan(similarity(reference, "Tattu R-Line 1550mAh 4S"));
  });

  it("scores a reference without model numbers on shared words alone", () => {
    expect(similarity("Foxeer Lollipop", "foxeer lollipop")).toBe(1);
    expect(similarity("Foxeer Lollipop", "Foxeer Lollipop antenna")).toBeLessThan(1);
  });
});
