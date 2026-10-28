import { describe, expect, it } from "vitest";
import { ShippingUnknown, StoreErrorKind } from "@fpving/plugin-sdk";
import { alertIdSchema, err, LlmErrorKind, LlmVerdict, ok, pluginIdSchema } from "../src/index.ts";
import { fakeClock } from "./fakes/fake-clock.ts";
import { fakeDebugSink } from "./fakes/fake-debug-sink.ts";
import { fakeIdGenerator } from "./fakes/fake-id-generator.ts";
import { fakeLlmJudge } from "./fakes/fake-llm.ts";
import { fakeNotifier } from "./fakes/fake-notifier.ts";
import { fakeCurrencyRates } from "./fakes/fake-rates.ts";
import { fakeStoreGateway } from "./fakes/fake-store-gateway.ts";

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

  it("fake llm judge gives its scripted answers and records compared titles", async () => {
    const unavailable = err({ kind: LlmErrorKind.Unavailable, detail: "no key" });
    const same = ok({ verdict: LlmVerdict.Same, reason: "Identical." });
    const judge = fakeLlmJudge({ identity: unavailable, verdict: same });
    expect(await judge.extractIdentity("title")).toEqual(unavailable);
    expect(await judge.compare("a", "b")).toEqual(same);
    expect(judge.compared).toEqual([["a", "b"]]);
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
    const pluginId = pluginIdSchema.parse("example-shop");
    expect(await sink.savePage(pluginId, "https://shop.example/x", "<html>")).toEqual(ok(undefined));
    expect(sink.pages).toEqual([{ pluginId, url: "https://shop.example/x", html: "<html>" }]);
  });

  it("fake store gateway resolves plugins by exact host, answers scripted results and records calls", async () => {
    const shop = pluginIdSchema.parse("example-shop");
    const quiet = pluginIdSchema.parse("quiet-shop");
    const itemPrice = { amountMinor: 1, currency: "USD" as const };
    const listing = ok({ title: "Motor", itemPrice, shipping: ShippingUnknown, inStock: true, images: [] });
    const found = ok([{ url: "https://shop.example/y", title: "Motor" }]);
    const stores = fakeStoreGateway([
      { id: shop, domains: ["shop.example"], listing, search: found },
      {
        id: quiet,
        domains: ["quiet.example", "q.example"],
        listing: err({ kind: StoreErrorKind.Blocked, detail: "captcha" }),
      },
    ]);
    expect(stores.declaredDomains()).toEqual(["shop.example", "quiet.example", "q.example"]);
    expect(stores.pluginFor("https://q.example/x")).toBe(quiet);
    expect(stores.pluginFor("https://www.shop.example/x")).toBeNull();
    expect(await stores.fetchListing(shop, "https://shop.example/x")).toEqual(listing);
    expect(stores.fetched).toEqual(["https://shop.example/x"]);
    expect(stores.searchablePlugins()).toEqual([shop]);
    expect(await stores.search(shop, { text: "Motor" })).toEqual(found);
    expect(stores.searched).toEqual([{ pluginId: shop, query: { text: "Motor" } }]);
  });
});
