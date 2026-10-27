import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, SearchCandidate, StoreResult } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  addListing,
  addProduct,
  CandidateStatus,
  err,
  findMatches,
  LlmErrorKind,
  LlmVerdict,
  matchCandidateIdSchema,
  MatchErrorKind,
  ok,
  pluginIdSchema,
  productIdSchema,
  RepositoryErrorKind,
  rejudgeUnjudged,
} from "../../src/index.ts";
import type { LlmError, MatchDeps, ProductIdentity, Repository, Result, Verdict } from "../../src/index.ts";
import { similarity } from "../../src/matching/similarity.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";
import { fakeLlmJudge } from "../fakes/fake-llm.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";
import { fakeStoreGateway } from "../fakes/fake-store-gateway.ts";

const PRICE = 3299;
const PER_STORE = 5;
const SOURCE = pluginIdSchema.parse("source-shop");
const SHOP_A = pluginIdSchema.parse("shop-a");
const SHOP_B = pluginIdSchema.parse("shop-b");
const NOW = new Date("2026-10-27T10:00:00.000Z");
const SOURCE_URL = "https://source.example/f60";
const SOURCE_TITLE = "T-Motor F60 Pro V 2207 1950KV Brushless Motor";
const IDENTITY: ProductIdentity = { brand: "T-Motor", model: "F60 Pro V", variantAttributes: ["1950KV"] };
const REFERENCE = "T-Motor F60 Pro V 1950KV";
const SAME: Verdict = { verdict: LlmVerdict.Same, reason: "Same motor and KV." };
const UNAVAILABLE: LlmError = { kind: LlmErrorKind.Unavailable, detail: "no key" };

const fetched = (title: string): FetchedListing => ({
  title,
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
  inStock: true,
  images: [],
});

const result = (url: string, title: string): SearchCandidate => ({ url, title });

const EXACT = result("https://a.example/f60?utm_source=feed", "T-Motor F60 Pro V 1950KV");
const OLDER = result("https://a.example/f60-iv", "T-Motor F60 Pro IV 2207 2550KV");
const OTHER_STORE = result("https://b.example/item/7", "F60 Pro V 1950KV motor T-Motor");

interface Options {
  readonly identity?: Result<ProductIdentity, LlmError>;
  readonly verdict?: Result<Verdict, LlmError>;
  readonly a?: StoreResult<SearchCandidate[]>;
  readonly b?: StoreResult<SearchCandidate[]>;
}

const gateway = (a: StoreResult<SearchCandidate[]>, b: StoreResult<SearchCandidate[]>) =>
  fakeStoreGateway([
    { id: SOURCE, domains: ["source.example"], listing: ok(fetched(SOURCE_TITLE)), search: ok([]) },
    { id: SHOP_A, domains: ["a.example"], listing: ok(fetched(EXACT.title)), search: a },
    { id: SHOP_B, domains: ["b.example"], listing: ok(fetched(OTHER_STORE.title)), search: b },
    { id: pluginIdSchema.parse("no-search"), domains: ["n.example"], listing: ok(fetched("unused")) },
  ]);

const setup = async (options: Options = {}) => {
  const repository = inMemoryRepository();
  const stores = gateway(options.a ?? ok([EXACT, OLDER]), options.b ?? ok([OTHER_STORE]));
  const llm = fakeLlmJudge({ identity: options.identity ?? ok(IDENTITY), verdict: options.verdict ?? ok(SAME) });
  const clock = fakeClock(NOW);
  const deps: MatchDeps = { repository, stores, llm, ids: fakeIdGenerator(), clock };
  const added = await addProduct(deps, SOURCE_URL);
  if (!added.ok) {
    throw new Error("could not add the source product");
  }
  return { deps, repository, stores, llm, clock, productId: added.value.product.id };
};

const forgetful = (repository: Repository): Repository => ({
  ...repository,
  matchCandidates: { ...repository.matchCandidates, isKnownUrl: async () => Promise.resolve(false) },
});

describe("Finding matches for a product", () => {
  it("searches every other searchable store for brand and model and saves judged candidates as pending", async () => {
    const { deps, repository, stores, productId } = await setup();
    const found = await findMatches(deps, productId);
    const query = { text: "T-Motor F60 Pro V", brand: "T-Motor", model: "F60 Pro V" };
    expect(stores.searched).toEqual([{ pluginId: SHOP_A, query }, { pluginId: SHOP_B, query }]);
    const exact = {
      id: matchCandidateIdSchema.parse("id-4"),
      productId,
      pluginId: SHOP_A,
      url: "https://a.example/f60",
      title: EXACT.title,
      similarityScore: similarity(REFERENCE, EXACT.title),
      llmVerdict: LlmVerdict.Same,
      llmReason: SAME.reason,
      status: CandidateStatus.Pending,
    };
    const older = { ...exact, id: matchCandidateIdSchema.parse("id-5"), url: OLDER.url, title: OLDER.title };
    const other = { ...exact, id: matchCandidateIdSchema.parse("id-6"), pluginId: SHOP_B, url: OTHER_STORE.url };
    const expected = [
      exact,
      { ...older, similarityScore: similarity(REFERENCE, OLDER.title) },
      { ...other, title: OTHER_STORE.title, similarityScore: similarity(REFERENCE, OTHER_STORE.title) },
    ];
    expect(found).toEqual(ok({ candidates: expected, failedSearches: [] }));
    expect(await repository.matchCandidates.listPending()).toEqual(
      expected.toSorted((x, y) => y.similarityScore - x.similarityScore),
    );
  });

  it("asks the LLM to compare the source listing title with each candidate title", async () => {
    const { deps, llm, productId } = await setup();
    await findMatches(deps, productId);
    expect(llm.compared).toEqual([
      [SOURCE_TITLE, EXACT.title],
      [SOURCE_TITLE, OLDER.title],
      [SOURCE_TITLE, OTHER_STORE.title],
    ]);
  });

  it("uses the product's earliest manual listing as the source and never searches its store", async () => {
    const { deps, stores, llm, clock, productId } = await setup({ b: ok([]) });
    clock.advance(1);
    await addListing(deps, productId, "https://b.example/f60-later");
    await findMatches(deps, productId);
    expect(stores.searched.map((row) => row.pluginId)).toEqual([SHOP_A, SHOP_B]);
    expect(llm.compared.map(([source]) => source)).toEqual([SOURCE_TITLE, SOURCE_TITLE]);
  });

  it("keeps the five most similar results of each store, most similar first", async () => {
    const titles = ["F60 Pro V", "1950KV", "T-Motor F60", "T-Motor F60 Pro V 1950KV", "Pro V", "T-Motor", "F60"];
    const many = titles.map((title, index) => result(`https://a.example/r${String(index)}`, title));
    const { deps, productId } = await setup({ a: ok(many), b: ok([]) });
    const found = await findMatches(deps, productId);
    const best = titles
      .map((title) => similarity(REFERENCE, title))
      .toSorted((x, y) => y - x)
      .slice(0, PER_STORE);
    expect(found.ok && found.value.candidates.map((row) => row.similarityScore)).toEqual(best);
  });

  it("drops results already tracked, suggested or rejected for the product, comparing normalized urls", async () => {
    const { deps, repository, productId } = await setup({ a: ok([EXACT]), b: ok([]) });
    await findMatches(deps, productId);
    const [suggested] = await repository.matchCandidates.listPending();
    await repository.matchCandidates.reject(suggested?.id ?? matchCandidateIdSchema.parse("missing"));
    const tracked = result("https://www.source.example/f60/", "T-Motor F60 Pro V");
    const fresh = result("https://a.example/f60-v2", "T-Motor F60 Pro V2");
    const pending = result("https://a.example/f60-v3", "T-Motor F60 Pro V3");
    await findMatches({ ...deps, stores: gateway(ok([pending]), ok([])) }, productId);
    const stores = gateway(ok([EXACT, tracked, pending, fresh]), ok([]));
    const found = await findMatches({ ...deps, stores }, productId);
    expect(found.ok && found.value.candidates.map((row) => row.url)).toEqual([fresh.url]);
  });

  it("drops results whose url is not an http or https url and keeps the first of results sharing a url", async () => {
    const twin = result("https://a.example/f60#reviews", "T-Motor F60 Pro V 1950KV twin");
    const { deps, productId } = await setup({ a: ok([result("ftp://a.example/f60", "T-Motor F60"), EXACT, twin]) });
    const found = await findMatches(deps, productId);
    expect(found.ok && found.value.candidates.map((row) => [row.url, row.title])).toEqual([
      ["https://a.example/f60", EXACT.title],
      [OTHER_STORE.url, OTHER_STORE.title],
    ]);
  });

  it("reports each store whose search failed and still saves the other stores' candidates", async () => {
    const blocked = { kind: StoreErrorKind.Blocked, detail: "captcha" } as const;
    const { deps, productId } = await setup({ a: err(blocked) });
    const found = await findMatches(deps, productId);
    expect(found.ok && found.value.failedSearches).toEqual([{ pluginId: SHOP_A, error: blocked }]);
    expect(found.ok && found.value.candidates.map((row) => row.url)).toEqual([OTHER_STORE.url]);
  });

  it("uses a cached verdict for the source and candidate urls without asking the LLM", async () => {
    const { deps, repository, llm, productId } = await setup({ a: ok([EXACT]), b: ok([]) });
    const cached = { verdict: LlmVerdict.Variant, reason: "Cached." };
    const candidateUrl = "https://a.example/f60";
    await repository.verdictCache.put({ ...cached, sourceUrl: SOURCE_URL, candidateUrl, judgedAt: NOW });
    const found = await findMatches(deps, productId);
    expect(found.ok && found.value.candidates.map((row) => [row.llmVerdict, row.llmReason])).toEqual([
      [cached.verdict, cached.reason],
    ]);
    expect(llm.compared).toEqual([]);
  });

  it("caches each verdict the LLM gives by source and candidate url, stamped with the clock", async () => {
    const { deps, repository, productId } = await setup({ a: ok([EXACT]), b: ok([]) });
    await findMatches(deps, productId);
    expect(await repository.verdictCache.get(SOURCE_URL, "https://a.example/f60")).toEqual({
      ...SAME,
      sourceUrl: SOURCE_URL,
      candidateUrl: "https://a.example/f60",
      judgedAt: NOW,
    });
  });

  it("saves candidates unjudged with no reason when the LLM fails, by similarity, and caches nothing", async () => {
    const { deps, repository, productId } = await setup({ verdict: err(UNAVAILABLE), b: ok([]) });
    const found = await findMatches(deps, productId);
    expect(found.ok && found.value.candidates.map((row) => [row.url, row.llmVerdict, row.llmReason])).toEqual([
      ["https://a.example/f60", LlmVerdict.Unjudged, null],
      [OLDER.url, LlmVerdict.Unjudged, null],
    ]);
    expect(await repository.verdictCache.get(SOURCE_URL, OLDER.url)).toBeNull();
  });

  it("searches for and scores against the source listing title when its identity cannot be extracted", async () => {
    const { deps, stores, productId } = await setup({ identity: err(UNAVAILABLE), b: ok([]) });
    const found = await findMatches(deps, productId);
    expect(stores.searched.map((row) => row.query)).toEqual([{ text: SOURCE_TITLE }, { text: SOURCE_TITLE }]);
    expect(found.ok && found.value.candidates.map((row) => row.similarityScore)).toEqual([
      similarity(SOURCE_TITLE, EXACT.title),
      similarity(SOURCE_TITLE, OLDER.title),
    ]);
  });

  it("refuses a product without a manual listing", async () => {
    const { deps } = await setup();
    expect(await findMatches(deps, productIdSchema.parse("missing"))).toEqual(
      err({ kind: MatchErrorKind.NoSourceListing }),
    );
  });

  it("saves nothing and reports duplicate_url when another run suggested one of the urls meanwhile", async () => {
    const { deps, repository, productId } = await setup({ b: ok([]) });
    await findMatches(deps, productId);
    const racing = { ...deps, repository: forgetful(repository) };
    expect(await findMatches(racing, productId)).toEqual(err({ kind: RepositoryErrorKind.DuplicateUrl }));
  });
});

describe("Judging unjudged candidates again", () => {
  const unjudgedFirst = async () => {
    const context = await setup({ verdict: err(UNAVAILABLE), b: ok([]) });
    await findMatches(context.deps, context.productId);
    const llm = fakeLlmJudge({ identity: ok(IDENTITY), verdict: ok(SAME) });
    return { ...context, deps: { ...context.deps, llm }, llm };
  };

  it("judges the product's pending unjudged candidates, records and caches the verdicts and returns them", async () => {
    const { deps, repository, productId } = await unjudgedFirst();
    const rejudged = await rejudgeUnjudged(deps, productId);
    const pending = await repository.matchCandidates.listPending();
    expect(pending.map((row) => [row.url, row.llmVerdict, row.llmReason])).toEqual([
      ["https://a.example/f60", SAME.verdict, SAME.reason],
      [OLDER.url, SAME.verdict, SAME.reason],
    ]);
    expect(rejudged).toEqual(ok(pending));
    expect(await repository.verdictCache.get(SOURCE_URL, OLDER.url)).toEqual({
      ...SAME,
      sourceUrl: SOURCE_URL,
      candidateUrl: OLDER.url,
      judgedAt: NOW,
    });
  });

  it("leaves a candidate unjudged while the LLM still fails", async () => {
    const { deps, repository, productId } = await setup({ verdict: err(UNAVAILABLE), b: ok([]) });
    await findMatches(deps, productId);
    expect(await rejudgeUnjudged(deps, productId)).toEqual(ok([]));
    const pending = await repository.matchCandidates.listPending();
    expect(pending.map((row) => row.llmVerdict)).toEqual([LlmVerdict.Unjudged, LlmVerdict.Unjudged]);
  });

  it("leaves judged, decided and other products' candidates alone", async () => {
    const { deps, repository, llm, productId } = await unjudgedFirst();
    const other = await addProduct(deps, "https://source.example/other");
    expect(await rejudgeUnjudged(deps, other.ok ? other.value.product.id : productId)).toEqual(ok([]));
    const [exact] = await repository.matchCandidates.listPending();
    await repository.matchCandidates.reject(exact?.id ?? matchCandidateIdSchema.parse("missing"));
    await rejudgeUnjudged(deps, productId);
    await rejudgeUnjudged(deps, productId);
    expect(llm.compared).toEqual([[SOURCE_TITLE, OLDER.title]]);
  });

  it("refuses a product without a manual listing", async () => {
    const { deps } = await unjudgedFirst();
    expect(await rejudgeUnjudged(deps, productIdSchema.parse("missing"))).toEqual(
      err({ kind: MatchErrorKind.NoSourceListing }),
    );
  });

  it("rejects as a bug when a pending candidate cannot be found to record its verdict", async () => {
    const { deps, repository, productId } = await unjudgedFirst();
    const lost: Repository = {
      ...repository,
      matchCandidates: {
        ...repository.matchCandidates,
        recordVerdict: async () => Promise.resolve(err({ kind: RepositoryErrorKind.NotFound })),
      },
    };
    await expect(rejudgeUnjudged({ ...deps, repository: lost }, productId)).rejects.toThrow();
  });
});
