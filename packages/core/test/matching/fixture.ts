import { ShippingKind } from "@fpving/plugin-sdk";
import type { FetchedListing, SearchCandidate, StoreResult } from "@fpving/plugin-sdk";
import { addProduct, LlmErrorKind, LlmVerdict, ok, pluginIdSchema } from "../../src/index.ts";
import type { LlmError, MatchDeps, ProductIdentity, Result, Verdict } from "../../src/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";
import { fakeLlmJudge } from "../fakes/fake-llm.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";
import { fakeStoreGateway } from "../fakes/fake-store-gateway.ts";

export const PRICE = 3299;
export const SOURCE = pluginIdSchema.parse("source-shop");
export const SHOP_A = pluginIdSchema.parse("shop-a");
export const SHOP_B = pluginIdSchema.parse("shop-b");
export const NOW = new Date("2026-10-27T10:00:00.000Z");
export const SOURCE_URL = "https://source.example/f60";
export const SOURCE_TITLE = "T-Motor F60 Pro V 2207 1950KV Brushless Motor";
export const IDENTITY: ProductIdentity = { brand: "T-Motor", model: "F60 Pro V", variantAttributes: ["1950KV"] };
export const REFERENCE = "T-Motor F60 Pro V 1950KV";
export const SAME: Verdict = { verdict: LlmVerdict.Same, reason: "Same motor and KV." };
export const UNAVAILABLE: LlmError = { kind: LlmErrorKind.Unavailable, detail: "no key" };

export const fetched = (title: string): FetchedListing => ({
  title,
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
  inStock: true,
  images: [],
});

export const result = (url: string, title: string): SearchCandidate => ({ url, title });

export const EXACT = result("https://a.example/f60?utm_source=feed", "T-Motor F60 Pro V 1950KV");
export const OLDER = result("https://a.example/f60-iv", "T-Motor F60 Pro IV 2207 2550KV");
export const OTHER_STORE = result("https://b.example/item/7", "F60 Pro V 1950KV motor T-Motor");

interface Options {
  readonly identity?: Result<ProductIdentity, LlmError>;
  readonly verdict?: Result<Verdict, LlmError>;
  readonly a?: StoreResult<SearchCandidate[]>;
  readonly b?: StoreResult<SearchCandidate[]>;
  readonly aListing?: StoreResult<FetchedListing>;
}

export const gateway = (
  a: StoreResult<SearchCandidate[]>,
  b: StoreResult<SearchCandidate[]>,
  aListing: StoreResult<FetchedListing> = ok(fetched(EXACT.title)),
) =>
  fakeStoreGateway([
    { id: SOURCE, domains: ["source.example"], listing: ok(fetched(SOURCE_TITLE)), search: ok([]) },
    { id: SHOP_A, domains: ["a.example"], listing: aListing, search: a },
    { id: SHOP_B, domains: ["b.example"], listing: ok(fetched(OTHER_STORE.title)), search: b },
    { id: pluginIdSchema.parse("no-search"), domains: ["n.example"], listing: ok(fetched("unused")) },
  ]);

export const setup = async (options: Options = {}) => {
  const repository = inMemoryRepository();
  const stores = gateway(options.a ?? ok([EXACT, OLDER]), options.b ?? ok([OTHER_STORE]), options.aListing);
  const llm = fakeLlmJudge({ identity: options.identity ?? ok(IDENTITY), verdict: options.verdict ?? ok(SAME) });
  const clock = fakeClock(NOW);
  const deps: MatchDeps = { repository, stores, llm, ids: fakeIdGenerator(), clock };
  const added = await addProduct(deps, SOURCE_URL);
  if (!added.ok) {
    throw new Error("could not add the source product");
  }
  return { deps, repository, stores, llm, clock, productId: added.value.product.id };
};
