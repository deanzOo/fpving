import { describe, expect, it } from "vitest";
import { alertIdSchema, err, LlmErrorKind, LlmVerdict, ok } from "../src/index.ts";
import { fakeClock } from "./fakes/fake-clock.ts";
import { fakeDebugSink } from "./fakes/fake-debug-sink.ts";
import { fakeIdGenerator } from "./fakes/fake-id-generator.ts";
import { fakeLlmJudge } from "./fakes/fake-llm.ts";
import { fakeNotifier } from "./fakes/fake-notifier.ts";
import { fakeCurrencyRates } from "./fakes/fake-rates.ts";

const MINUTE_MS = 60_000;
const START = new Date("2026-01-01T00:00:00Z");

describe("Test fakes", () => {
  it("fake clock stands still until advanced", () => {
    const clock = fakeClock(START);
    expect(clock.now()).toEqual(START);
    clock.advance(MINUTE_MS);
    expect(clock.now()).toEqual(new Date("2026-01-01T00:01:00Z"));
  });

  it("fake id generator counts up deterministically", () => {
    const ids = fakeIdGenerator();
    expect([ids.next(), ids.next()]).toEqual(["id-1", "id-2"]);
  });

  it("fake llm judge gives its scripted answers", async () => {
    const unavailable = err({ kind: LlmErrorKind.Unavailable, detail: "no key" });
    const same = ok({ verdict: LlmVerdict.Same, reason: "Identical." });
    const judge = fakeLlmJudge({ identity: unavailable, verdict: same });
    expect(await judge.extractIdentity("title")).toEqual(unavailable);
    expect(await judge.compare("a", "b")).toEqual(same);
  });

  it("fake currency rates answer the given table", async () => {
    const table = ok({ base: "USD" as const, ratesPerBase: {}, fetchedOn: "2026-01-01" });
    expect(await fakeCurrencyRates(table).fetchLatest()).toEqual(table);
  });

  it("fake notifier records what it was asked to show", async () => {
    const notifier = fakeNotifier();
    const notification = { alertId: alertIdSchema.parse("a1"), title: "Price drop", body: "Now cheaper." };
    expect(await notifier.notify(notification)).toEqual(ok(undefined));
    expect(notifier.sent).toEqual([notification]);
  });

  it("fake debug sink records saved pages", async () => {
    const sink = fakeDebugSink();
    expect(await sink.savePage("example-shop", "https://shop.example/x", "<html>")).toEqual(ok(undefined));
    expect(sink.pages).toEqual([{ pluginId: "example-shop", url: "https://shop.example/x", html: "<html>" }]);
  });
});
