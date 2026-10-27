---
title: "0010. Single aggregate required check"
description: Single aggregate required check.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

The CI matrix and job list change over time. Branch protection that names each job must be edited whenever a job is added, renamed or skipped, and a missed edit silently drops a gate.

## Considered options

- Require every CI job by name.
- Require one aggregate check that depends on all jobs.

## Decision outcome

The CI workflow ends with a `ci-ok` job that needs every other job and fails unless each one passed or was intentionally skipped. Branch protection requires `ci-ok` and the PR title check `semantic-title`.

## Consequences

- Good: adding a job means adding it to the aggregate's `needs`, not editing repository settings.
- Good: skipped jobs, such as the commit message check on Dependabot PRs, do not block merging.
- Bad: a job left out of `needs` is not gated, so reviews of CI changes must check it.
