---
title: "0001. Record architecture decisions"
description: Record architecture decisions.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Significant choices in this project need a durable, public explanation. Without one, contributors rediscover and relitigate them, and the reasoning is lost.

## Considered options

- No written record; decisions live in chat and commit messages.
- A wiki or issue tracker.
- Architecture decision records (ADRs) in the repository, in MADR format.

## Decision outcome

ADRs in MADR format, stored in `apps/docs/src/content/docs/adr/` and published on this site.

## Consequences

- Good: reasoning is versioned with the code and reviewed in pull requests.
- Good: new contributors can see why, not only what.
- Cost: a new dependency, a new port or a cross-cutting decision needs an ADR before it merges.
- Accepted records are superseded by a new ADR, never rewritten.
