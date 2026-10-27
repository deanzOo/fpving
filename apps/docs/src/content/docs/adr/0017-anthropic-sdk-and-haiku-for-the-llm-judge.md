---
title: "0017. Anthropic SDK and Haiku for the LLM judge"
description: Which client library and model implement the LlmJudge port.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

The `LlmJudge` port needs a real adapter. It extracts a product identity from a listing title and judges a candidate title against a source title as same, variant or different. Both are short classification tasks, run for many candidates per product, on the user's own API key. Answers must be machine-readable and validated, failures must become typed `LlmError`s, and calls must be limited so a match run does not flood the API.

## Considered options

- `@anthropic-ai/sdk` with `claude-haiku-5-5`. Chosen.
- `fetch` against the Messages API directly. Rejected: it would reimplement the typed error classes, retries with backoff on 429 and 5xx, and the Zod structured output helper the SDK already ships.
- A larger model such as Sonnet or Opus. Rejected: the tasks are short classifications where a cheap model is enough, and the user pays per call. The matcher eval decides whether that stays true.

## Decision outcome

`apps/fpving` depends on `@anthropic-ai/sdk` (Apache-2.0). The adapter in `apps/fpving/src/adapters/anthropic` calls `claude-haiku-5-5` (`MATCHER_MODEL`) at `effort: "low"` with adaptive thinking left at its default, and constrains the answer with `output_config.format` built by the SDK's `zodOutputFormat` from the core `productIdentitySchema` and `verdictSchema`. It sends requests with `messages.create`, not `messages.parse`, because `parse` parses the text before the caller can look at `stop_reason`: it checks `stop_reason` first, so a refusal is `unavailable`, an answer cut off at `max_tokens` or any other stop is `malformed_output`, and only then validates the text against the Zod schema. `max_tokens` is 1024, room for low-effort thinking and a JSON answer of a few dozen tokens.

SDK errors map to `unavailable` by class, most specific first (rate limit, authentication, bad request, connection, any other API error), never by message text. The SDK's own retries (two, on 429 and 5xx) are the only retries. At most four calls are in flight per judge (`MAX_IN_FLIGHT`). Every failure is logged as a warning with the method, kind and detail; the API key is never logged.

The compare prompt lists the labelling rules from `packages/core/eval/pairs.json`, imported through the `@fpving/core/eval/pairs.json` export, so the judge and the eval share one set of rules. Prompts hold no timestamps or other changing text, so identical inputs send identical requests.

`pnpm eval:matcher` runs every labelled pair through the real adapter and fails below 90% overall accuracy. It skips with a message and exits 0 when `ANTHROPIC_API_KEY` is not set. The nightly workflow runs it on `main` only when the repository has an `ANTHROPIC_API_KEY` secret; pull request CI never sees the key.

## Consequences

- Good: typed errors, retries and schema-constrained output come from the vendor SDK, and the adapter stays small.
- Good: changing the rules in `pairs.json` changes the prompt and the eval together.
- Bad: one more runtime dependency, which pulls in `@opentelemetry/api`, `json-schema-to-ts` and `standardwebhooks`.
- Bad: the model id is pinned in code; moving to a newer Haiku is a code change, checked by rerunning the eval.
