import { err, ok } from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import { ListingOrigin } from "../entities.js";
import type { MatchCandidate } from "../entities.js";
import type { MatchCandidateId } from "../ids.js";
import type { Repository } from "../ports/repository.js";
import { RepositoryErrorKind } from "../ports/repository.js";
import { alreadyTracked, newListing } from "../products/add.js";
import type { AddDeps, AddedListing, AlreadyTracked, FetchFailed, Target } from "../products/add.js";
import { AddErrorKind } from "../products/errors.js";
import { MatchErrorKind } from "./errors.js";

/** No pending candidate has the id: it does not exist, or it was already accepted or rejected. */
export interface NotPending {
  readonly kind: typeof MatchErrorKind.NotPending;
}

/**
 * Why {@link acceptCandidate} stored nothing: the candidate is not pending, the store could not fetch it, or a
 * listing already tracks its url.
 */
export type AcceptCandidateError = NotPending | FetchFailed | AlreadyTracked;

const notPending = err({ kind: MatchErrorKind.NotPending });

const pendingCandidate = async (
  repository: Repository,
  id: MatchCandidateId,
): Promise<Result<MatchCandidate, NotPending>> => {
  const candidate = (await repository.matchCandidates.listPending()).find((row) => row.id === id);
  return candidate === undefined ? notPending : ok(candidate);
};

/**
 * Accepts a pending match candidate: fetches its page and adds it to the candidate's product as a `matched` listing
 * with its first snapshot, marking the candidate accepted, all or nothing.
 *
 * @remarks
 * The listing and snapshot are built exactly like {@link addListing} builds them. A candidate that is not pending
 * is never fetched, and one decided during the fetch yields `not_pending` and stores nothing. When the fetch fails,
 * or a listing started tracking the url meanwhile, the candidate stays pending.
 *
 * @param deps - The ports to use.
 * @param id - The candidate to accept.
 * @returns What was stored, or why nothing was.
 */
export const acceptCandidate = async (
  deps: AddDeps,
  id: MatchCandidateId,
): Promise<Result<AddedListing, AcceptCandidateError>> => {
  const candidate = await pendingCandidate(deps.repository, id);
  if (!candidate.ok) {
    return candidate;
  }
  const { productId, pluginId, url } = candidate.value;
  const fetched = await deps.stores.fetchListing(pluginId, url);
  if (!fetched.ok) {
    return err({ kind: AddErrorKind.FetchFailed, error: fetched.error });
  }
  const target: Target = { url, pluginId, fetched: fetched.value };
  const added = await newListing(deps, productId, target, ListingOrigin.Matched, deps.clock.now());
  const stored = await deps.repository.matchCandidates.accept(id, added.listing, added.snapshot);
  if (stored.ok) {
    return ok(added);
  }
  return stored.error.kind === RepositoryErrorKind.NotFound ? notPending : alreadyTracked(deps.repository, url);
};

/**
 * Rejects a pending match candidate, so its url is never suggested for the product again.
 *
 * @param deps - The repository to use.
 * @param id - The candidate to reject.
 * @returns Nothing, or `not_pending`.
 */
export const rejectCandidate = async (
  { repository }: Pick<AddDeps, "repository">,
  id: MatchCandidateId,
): Promise<Result<void, NotPending>> => {
  const rejected = await repository.matchCandidates.reject(id);
  return rejected.ok ? rejected : notPending;
};
