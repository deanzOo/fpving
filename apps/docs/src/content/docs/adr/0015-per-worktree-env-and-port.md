---
title: "0015. Per-worktree env and port"
description: How each git worktree gets its own port and data directory.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

Parallel branches live in separate git worktrees, and each can run the app. Two servers on one port, or two worktrees writing one data directory, would corrupt each other's runs. The settings must also be validated once, at startup, with errors that never echo a secret.

## Considered options

- Set a port and data directory by hand in every worktree.
- A `worktree:init` script that derives both from the worktree path.
- A random free port picked at every start.

## Decision outcome

`pnpm worktree:init` writes `.env` from `.env.example`. The port is `4000 + fnv1a(absolute worktree path) % 1000`, so it is stable per worktree and needs no state or crypto dependency. `DATA_DIR` is `.data/<worktree directory name>`. An existing `.env` is never overwritten. The app reads `PORT`, `DATA_DIR`, `ANTHROPIC_API_KEY` (optional) and `LOG_LEVEL` through a Zod schema, which adds `zod` to `apps/fpving`; the project already uses it in core and the SDK. Error messages name the variable and the rule, never its value.

## Consequences

- Good: a fresh worktree gets a working, collision-resistant setup in one command, and a restart keeps the same port.
- Bad: the hash can collide, one chance in a thousand per pair of worktrees; edit `PORT` in `.env` when it does.
- Bad: only the port and data directory are isolated so far. The Playwright profile and logs come with the E2E suite.
