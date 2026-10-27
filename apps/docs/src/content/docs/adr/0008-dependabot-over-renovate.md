---
title: "0008. Dependabot over Renovate"
description: Dependabot over Renovate.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Dependencies and pinned GitHub Actions need regular updates. The project wants minimal moving parts and keeps every merge to `main` as a human decision.

## Considered options

- Renovate.
- Dependabot.

## Decision outcome

Dependabot for npm and GitHub Actions, weekly, with minor and patch updates grouped. It is native to GitHub and needs no app installation. There is no auto-merge: every update waits for the owner.

## Consequences

- Good: no third-party app or extra permissions.
- Good: security updates and alerts come from the same system.
- Bad: less configurable grouping and scheduling than Renovate.
