import { LlmVerdict } from "@fpving/core";
import type { MatchCandidate, Product } from "@fpving/core";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useClient } from "./client.ts";
import { useFocusAfterRemoval } from "./focus.ts";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { Button, ButtonSize } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { LINK } from "./ui/link.ts";
import { Notice, NoticeTone } from "./ui/notice.tsx";
import { Panel } from "./ui/panel.tsx";

const PERCENT = 100;

const VERDICT = {
  [LlmVerdict.Same]: { label: "Same product", tone: BadgeTone.Good, glyph: "✓" },
  [LlmVerdict.Variant]: { label: "A variant", tone: BadgeTone.Info, glyph: "≈" },
  [LlmVerdict.Different]: { label: "Different product", tone: BadgeTone.Neutral, glyph: "≠" },
  [LlmVerdict.Unjudged]: { label: "Not judged yet", tone: BadgeTone.Pending, glyph: "?" },
} as const;

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
  readonly featured: boolean;
  readonly announce: (said: string) => void;
  readonly reviewing: (underway: boolean) => void;
}

const Candidate = ({ candidate, product, featured, announce, reviewing }: CandidateProps) => {
  const client = useClient();
  const reviewed = useReviewed(product.id);
  const tracked = {
    onMutate: () => {
      reviewing(true);
    },
    onError: () => {
      reviewing(false);
    },
  };
  const accept = useMutation({
    mutationFn: client.acceptCandidate,
    ...tracked,
    onSuccess: async () => {
      announce(`Added ${candidate.title} to ${product.name}.`);
      await reviewed();
    },
  });
  const reject = useMutation({
    mutationFn: client.rejectCandidate,
    ...tracked,
    onSuccess: async () => {
      announce(`Rejected ${candidate.title}.`);
      await reviewed();
    },
  });
  const failed = accept.error ?? reject.error;
  const params = { candidateId: candidate.id };
  const busy = accept.isPending || reject.isPending;
  const { label, tone, glyph } = VERDICT[candidate.llmVerdict];
  const review = (
    <div className="flex flex-col gap-2">
      <a href={candidate.url} target="_blank" rel="noreferrer" className={`self-start type-body ${LINK}`}>
        {candidate.title}
      </a>
      <p className="flex flex-wrap items-center gap-2 type-body">
        <Badge tone={tone} glyph={glyph}>{label}</Badge>
        {candidate.llmReason === null
          ? null
          : (
              <>
                <span className="sr-only">: </span>
                <span>{candidate.llmReason}</span>
              </>
            )}
      </p>
      <p className="text-ink-muted type-small">
        <span className="type-readout">{Math.round(candidate.similarityScore * PERCENT)}%</span>
        {" similar, on "}
        <span className="type-code">{candidate.pluginId}</span>
      </p>
      <div className="flex gap-2">
        <Button
          size={ButtonSize.Small}
          pending={busy}
          pendingLabel={accept.isPending ? "Accepting…" : undefined}
          aria-label={`Accept ${candidate.title}`}
          onClick={() => {
            accept.mutate(params);
          }}
        >
          Accept
        </Button>
        <Button
          size={ButtonSize.Small}
          pending={busy}
          pendingLabel={reject.isPending ? "Rejecting…" : undefined}
          aria-label={`Reject ${candidate.title}`}
          onClick={() => {
            reject.mutate(params);
          }}
        >
          Reject
        </Button>
      </div>
      {failed !== null && <Refused error={failed} />}
    </div>
  );
  return (
    <li tabIndex={-1} className={featured ? "py-3" : "border-b border-line py-3"}>
      {featured ? <Panel featured>{review}</Panel> : review}
    </li>
  );
};

interface GroupProps {
  readonly product: Product;
  readonly candidates: readonly MatchCandidate[];
  readonly featured: string | undefined;
}

const Group = ({ product, candidates, featured }: GroupProps) => {
  const client = useClient();
  const headingId = useId();
  const queryClient = useQueryClient();
  const [said, announce] = useState("");
  const { list, heading, track } = useFocusAfterRemoval(
    (candidateId) => candidates.some(({ id }) => id === candidateId),
  );
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
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 ref={heading} id={headingId} tabIndex={-1} className="type-heading">{product.name}</h2>
        <Button
          pending={find.isPending}
          pendingLabel="Searching the other stores…"
          onClick={() => {
            find.mutate({ productId: product.id });
          }}
        >
          Find matches
        </Button>
      </div>
      <div className="has-[p]:mt-2">
        <Notice tone={NoticeTone.Status} tag="Done">{said}</Notice>
      </div>
      {find.isError && (
        <div className="mt-2">
          <Refused error={find.error} />
        </div>
      )}
      {candidates.length === 0
        ? <p className="mt-2 text-ink-muted type-body">No pending candidates.</p>
        : (
            <ul ref={list} className="mt-2 flex flex-col">
              {candidates.map((candidate, index) => (
                <Candidate
                  key={candidate.id}
                  candidate={candidate}
                  product={product}
                  featured={candidate.id === featured}
                  announce={announce}
                  reviewing={(underway) => {
                    track(underway ? { id: candidate.id, index } : null);
                  }}
                />
              ))}
            </ul>
          )}
    </section>
  );
};

/**
 * The match review screen: every watched product with its pending candidates, each with the judge's verdict and
 * reason, its similarity and a link to its page, to accept or reject, and a search for more. Candidates judged
 * different are hidden unless the toggle shows them.
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
  const [showDifferent, setShowDifferent] = useState(false);
  const groups = pending.map(({ data }) => data).filter((group) => group !== undefined).map((group) => ({
    ...group,
    candidates: group.candidates.filter(({ llmVerdict }) => showDifferent || llmVerdict !== LlmVerdict.Different),
  }));
  const loaded = groups.length === products?.length;
  const [featured] = groups.flatMap(({ candidates }) => candidates.map(({ id }) => id));
  return (
    <section>
      <h1 className="type-title">Matches</h1>
      <div className="mt-4">
        <Checkbox
          label="Show candidates judged different"
          checked={showDifferent}
          onChange={(event) => {
            setShowDifferent(event.target.checked);
          }}
        />
      </div>
      <div className="mt-6">
        {!loaded && <p className="text-ink-muted type-body">Loading…</p>}
        {products?.length === 0 && (
          <EmptyState tag={EmptyTag.NoSignal}>Nothing is watched yet. Add a product on the Watchlist first.</EmptyState>
        )}
        {loaded && groups.length > 0 && featured === undefined && (
          <EmptyState tag={EmptyTag.Clear}>No match candidates are waiting for review.</EmptyState>
        )}
      </div>
      {loaded && groups.map(({ product, candidates }) => (
        <Group key={product.id} product={product} candidates={candidates} featured={featured} />
      ))}
    </section>
  );
};
