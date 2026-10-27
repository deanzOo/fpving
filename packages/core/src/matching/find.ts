import { err, ok } from "@fpving/plugin-sdk";
import type { Result, SearchQuery, StoreError } from "@fpving/plugin-sdk";
import { CandidateStatus, ListingOrigin, LlmVerdict } from "../entities.js";
import type { Listing, MatchCandidate, Verdict } from "../entities.js";
import { matchCandidateIdSchema } from "../ids.js";
import type { PluginId, ProductId } from "../ids.js";
import type { LlmError, LlmJudge, ProductIdentity } from "../ports/llm-judge.js";
import type { DuplicateUrl, Repository } from "../ports/repository.js";
import type { AddDeps } from "../products/add.js";
import { normalizeListingUrl } from "../products/normalize-url.js";
import { MatchErrorKind } from "./errors.js";
import { similarity } from "./similarity.js";

const CANDIDATES_PER_STORE = 5;

/** The ports assisted matching uses: those of adding a product, and the LLM that judges candidates. */
export interface MatchDeps extends AddDeps {
  /** Extracts the product identity and judges each candidate. */
  readonly llm: LlmJudge;
}

/** The product has no manual listing to match from, or does not exist. */
export interface NoSourceListing {
  readonly kind: typeof MatchErrorKind.NoSourceListing;
}

/** A store whose search failed; `error` is the store's error, unchanged. */
export interface FailedSearch {
  readonly pluginId: PluginId;
  readonly error: StoreError;
}

/** What {@link findMatches} did. */
export interface MatchReport {
  /** The candidates it saved as pending, each store's most similar first. */
  readonly candidates: MatchCandidate[];
  /** The stores whose search failed, which added no candidates. */
  readonly failedSearches: FailedSearch[];
}

/**
 * Why {@link findMatches} saved nothing: no source listing, or `duplicate_url` when another run suggested one of the
 * urls between the check and the save.
 */
export type FindMatchesError = NoSourceListing | DuplicateUrl;

interface Found {
  readonly pluginId: PluginId;
  readonly url: string;
  readonly title: string;
}

interface Searched {
  readonly found: Found[];
  readonly failedSearches: FailedSearch[];
}

const sourceListing = async (
  repository: Repository,
  productId: ProductId,
): Promise<Result<Listing, NoSourceListing>> => {
  const listings = await repository.listings.listByProduct(productId);
  const source = listings.find((row) => row.origin === ListingOrigin.Manual);
  return source === undefined ? err({ kind: MatchErrorKind.NoSourceListing }) : ok(source);
};

const judge = async (
  { repository, llm, clock }: MatchDeps,
  source: Listing,
  candidate: Pick<MatchCandidate, "url" | "title">,
): Promise<Verdict | null> => {
  const cached = await repository.verdictCache.get(source.url, candidate.url);
  if (cached !== null) {
    return { verdict: cached.verdict, reason: cached.reason };
  }
  const judged = await llm.compare(source.title, candidate.title);
  if (!judged.ok) {
    return null;
  }
  await repository.verdictCache.put({
    ...judged.value,
    sourceUrl: source.url,
    candidateUrl: candidate.url,
    judgedAt: clock.now(),
  });
  return judged.value;
};

const searchTerms = (
  identity: Result<ProductIdentity, LlmError>,
  title: string,
): { query: SearchQuery; reference: string } => {
  if (!identity.ok) {
    return { query: { text: title }, reference: title };
  }
  const { brand, model, variantAttributes } = identity.value;
  const reference = [brand, model, ...variantAttributes].join(" ");
  return { query: { text: `${brand} ${model}`, brand, model }, reference };
};

const searchAll = async ({ stores }: MatchDeps, plugins: PluginId[], query: SearchQuery): Promise<Searched> => {
  const domains = stores.declaredDomains();
  const searches = await Promise.all(
    plugins.map(async (pluginId) => ({ pluginId, results: await stores.search(pluginId, query) })),
  );
  const found: Found[] = [];
  const failedSearches: FailedSearch[] = [];
  for (const { pluginId, results } of searches) {
    if (!results.ok) {
      failedSearches.push({ pluginId, error: results.error });
      continue;
    }
    for (const row of results.value) {
      const url = normalizeListingUrl(row.url, domains);
      if (url.ok && !found.some((other) => other.url === url.value)) {
        found.push({ pluginId, url: url.value, title: row.title });
      }
    }
  }
  return { found, failedSearches };
};

/**
 * Searches the other stores for a product and saves the likeliest results as pending match candidates, judged by the
 * LLM where it answers.
 *
 * @remarks
 * - The source is the product's earliest manual listing. The LLM extracts its identity, and every searchable store
 *   except the source's is searched in parallel for its brand and model. When no identity can be extracted, the
 *   stores are searched for the source title instead, and candidates are scored against it.
 * - A failed search is reported in `failedSearches` and does not stop the others.
 * - Result urls are normalized with {@link normalizeListingUrl}; invalid ones and repeats are dropped, and so is any
 *   url a listing tracks or that was already suggested for the product, rejected included.
 * - The rest are scored with a similarity of model numbers and shared words, and the five most similar of each
 *   store are kept.
 * - Each is judged against the source title, from the verdict cache by source and candidate url when it holds the
 *   pair, else by the LLM, whose verdict is cached. A candidate the LLM could not judge is saved `unjudged` with no
 *   reason, ranked by its similarity until {@link rejudgeUnjudged} judges it.
 *
 * @param deps - The ports to use.
 * @param productId - The product to find matches for.
 * @returns The saved candidates and the failed searches, or why nothing was saved.
 */
export const findMatches = async (
  deps: MatchDeps,
  productId: ProductId,
): Promise<Result<MatchReport, FindMatchesError>> => {
  const source = await sourceListing(deps.repository, productId);
  if (!source.ok) {
    return source;
  }
  const { title, pluginId: sourcePlugin } = source.value;
  const identity = await deps.llm.extractIdentity(title);
  const { query, reference } = searchTerms(identity, title);
  const plugins = deps.stores.searchablePlugins().filter((id) => id !== sourcePlugin);
  const { found, failedSearches } = await searchAll(deps, plugins, query);
  const known = await Promise.all(
    found.map(async (row) => deps.repository.matchCandidates.isKnownUrl(productId, row.url)),
  );
  const scored = found
    .filter((_, index) => known[index] !== true)
    .map((row) => ({ ...row, similarityScore: similarity(reference, row.title) }));
  const kept = plugins.flatMap((id) =>
    scored
      .filter((row) => row.pluginId === id)
      .toSorted((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, CANDIDATES_PER_STORE),
  );
  const candidates = await Promise.all(
    kept.map(async (row): Promise<MatchCandidate> => {
      const id = matchCandidateIdSchema.parse(deps.ids.next());
      const verdict = await judge(deps, source.value, row);
      return {
        ...row,
        id,
        productId,
        llmVerdict: verdict?.verdict ?? LlmVerdict.Unjudged,
        llmReason: verdict?.reason ?? null,
        status: CandidateStatus.Pending,
      };
    }),
  );
  const saved = await deps.repository.matchCandidates.save(candidates);
  return saved.ok ? ok({ candidates, failedSearches }) : saved;
};

/**
 * Asks the LLM again to judge a product's pending candidates that are still `unjudged`, such as after it was
 * unavailable, and records each verdict it gives.
 *
 * @remarks
 * Judges exactly like {@link findMatches}, cache first. A candidate the LLM still cannot judge stays `unjudged`, and
 * one accepted or rejected while it was being judged is skipped.
 *
 * @param deps - The ports to use.
 * @param productId - The product whose candidates to judge.
 * @returns The candidates that are judged now, or `no_source_listing`.
 */
export const rejudgeUnjudged = async (
  deps: MatchDeps,
  productId: ProductId,
): Promise<Result<MatchCandidate[], NoSourceListing>> => {
  const source = await sourceListing(deps.repository, productId);
  if (!source.ok) {
    return source;
  }
  const pending = await deps.repository.matchCandidates.listPending();
  const unjudged = pending.filter((row) => row.productId === productId && row.llmVerdict === LlmVerdict.Unjudged);
  const judged = await Promise.all(
    unjudged.map(async (row): Promise<MatchCandidate | null> => {
      const verdict = await judge(deps, source.value, row);
      if (verdict === null) {
        return null;
      }
      const recorded = await deps.repository.matchCandidates.recordVerdict(row.id, verdict);
      return recorded.ok ? { ...row, llmVerdict: verdict.verdict, llmReason: verdict.reason } : null;
    }),
  );
  return ok(judged.filter((row) => row !== null));
};
