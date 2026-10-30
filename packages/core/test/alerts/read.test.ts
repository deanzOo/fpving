import { describe, expect, it } from "vitest";
import { markAllAlertsRead } from "../../src/index.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";

const UNREAD = 3;

describe("Marking every alert read", () => {
  it("marks every unread alert read in one step at the clock's time and says how many there were", async () => {
    const base = inMemoryRepository();
    const seen: Date[] = [];
    const repository = {
      ...base,
      alerts: {
        ...base.alerts,
        markAllRead: async (at: Date) => {
          seen.push(at);
          return Promise.resolve(UNREAD);
        },
      },
    };
    const now = new Date("2026-10-30T10:00:00.000Z");
    expect(await markAllAlertsRead({ repository, clock: { now: () => now } })).toBe(UNREAD);
    expect(seen).toEqual([now]);
  });
});
