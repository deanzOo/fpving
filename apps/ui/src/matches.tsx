import { LlmVerdict } from "@fpving/core";
import type { MatchCandidate, Product } from "@fpving/core";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toFailure, useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";

const PERCENT = 100;

const VERDICT_LABEL = {
  [LlmVerdict.Same]: "Same product",
  [LlmVerdict.Variant]: "A variant",
  [LlmVerdict.Different]: "Different product",
  [LlmVerdict.Unjudged]: "Not judged yet",
} as const;

const button = "rounded-md border border-line px-3 py-1 font-medium disabled:opacity-60";

const useReviewed = (productId: string) => {
  const queryClient = useQueryClient();
  return async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: [...QueryKey.Candidates, productId] }),
    queryClient.invalidateQueries({ queryKey: [...QueryKey.Product, productId] }),
    queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist }),
  ]);
};

interface CandidateProps {
  readonly candidate: MatchCandidate;
  readonly product: Product;
  readonly announce: (said: string) => void;
}

const Candidate = ({ candidate, product, announce }: CandidateProps) => {
  const client = useClient();
  const reviewed = useReviewed(product.id);
  const accept = useMutation({
    mutationFn: client.acceptCandidate,
    onSuccess: async () => {
      announce(`Added ${candidate.title} to ${product.name}.`);
      await reviewed();
    },
  });
  const reject = useMutation({ mutationFn: client.rejectCandidate, onSuccess: reviewed });
  const failed = accept.error ?? reject.error;
  const params = { candidateId: candidate.id };
  const busy = accept.isPending || reject.isPending;
  return (
    <li className="flex flex-col gap-1 rounded-md border border-line px-3 py-2">
      <a href={candidate.url} target="_blank" rel="noreferrer" className="font-medium underline">{candidate.title}</a>
      <p>
        {VERDICT_LABEL[candidate.llmVerdict]}
        {candidate.llmReason === null ? "" : `: ${candidate.llmReason}`}
      </p>
      <p className="text-sm text-ink-muted">
        {Math.round(candidate.similarityScore * PERCENT)}% similar, on {candidate.pluginId}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={button}
          disabled={busy}
          aria-label={`Accept ${candidate.title}`}
          onClick={() => {
            accept.mutate(params);
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          aria-label={`Reject ${candidate.title}`}
          onClick={() => {
            reject.mutate(params);
          }}
        >
          Reject
        </button>
      </div>
      {failed !== null && <p role="alert" className="text-critical">{explain(toFailure(failed))}</p>}
    </li>
  );
};

interface GroupProps {
  readonly product: Product;
  readonly candidates: readonly MatchCandidate[];
}

const Group = ({ product, candidates }: GroupProps) => {
  const client = useClient();
  const headingId = useId();
  const queryClient = useQueryClient();
  const [said, announce] = useState("");
  const find = useMutation({
    mutationFn: client.findMatches,
    onSuccess: async (found) => {
      announce([
        `Saved ${String(found.candidates.length)} candidates.`,
        ...found.failedSearches.map(({ pluginId, error }) => `The search failed on ${pluginId} (${error.kind}).`),
      ].join(" "));
      await queryClient.invalidateQueries({ queryKey: [...QueryKey.Candidates, product.id] });
    },
  });
  return (
    <section aria-labelledby={headingId} className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={headingId} className="text-xl font-semibold">{product.name}</h2>
        <button
          type="button"
          className={button}
          disabled={find.isPending}
          onClick={() => {
            find.mutate({ productId: product.id });
          }}
        >
          {find.isPending ? "Searching the other stores…" : "Find matches"}
        </button>
      </div>
      <p role="status" className="mt-2 text-sm text-ink-muted">{said}</p>
      {find.isError && <p role="alert" className="text-critical">{explain(toFailure(find.error))}</p>}
      {candidates.length === 0
        ? <p className="mt-2 text-ink-muted">No pending candidates.</p>
        : (
            <ul className="mt-2 flex flex-col gap-2">
              {candidates.map((candidate) => (
                <Candidate key={candidate.id} candidate={candidate} product={product} announce={announce} />
              ))}
            </ul>
          )}
    </section>
  );
};

/**
 * The match review screen: every watched product with its pending candidates, each with the judge's verdict and
 * reason, its similarity and a link to its page, to accept or reject, and a search for more.
 *
 * @returns The screen.
 */
export const Matches = () => {
  const client = useClient();
  const products = useQuery({
    queryKey: QueryKey.Watchlist,
    queryFn: async () => client.listProducts(),
    throwOnError: true,
  }).data;
  const pending = useQueries({
    queries: (products ?? []).map(({ product }) => ({
      queryKey: [...QueryKey.Candidates, product.id],
      queryFn: async () => ({ product, candidates: await client.listCandidates({ productId: product.id }) }),
      throwOnError: true,
    })),
  });
  const groups = pending.map(({ data }) => data).filter((group) => group !== undefined);
  const loaded = groups.length === products?.length;
  return (
    <section>
      <h1 className="text-2xl font-semibold">Matches</h1>
      {!loaded && <p className="mt-6 text-ink-muted">Loading…</p>}
      {products?.length === 0 && (
        <p className="mt-6 text-ink-muted">Nothing is watched yet. Add a product on the Watchlist first.</p>
      )}
      {loaded && groups.length > 0 && groups.every(({ candidates }) => candidates.length === 0) && (
        <p className="mt-6 text-ink-muted">No match candidates are waiting for review.</p>
      )}
      {loaded && groups.map(({ product, candidates }) => (
        <Group key={product.id} product={product} candidates={candidates} />
      ))}
    </section>
  );
};
