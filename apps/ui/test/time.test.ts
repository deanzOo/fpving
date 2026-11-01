import { describe, expect, it } from "vitest";
import { fromNow } from "../src/time.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FIVE = 5;
const THREE = 3;

describe("Relative time", () => {
  it.each([
    ["the same instant", 0, "now"],
    ["minutes ago", -FIVE * MINUTE_MS, "5 minutes ago"],
    ["hours ahead", THREE * HOUR_MS, "in 3 hours"],
    ["days ago", -THREE * DAY_MS, "3 days ago"],
  ])("says %s in the largest whole unit", (_label, offset, said) => {
    expect(fromNow(new Date(NOW.getTime() + offset), NOW, "en-US")).toBe(said);
  });
});
