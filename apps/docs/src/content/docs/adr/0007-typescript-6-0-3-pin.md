---
title: "0007. Pin TypeScript to 6.0.3"
description: Pin TypeScript to 6.0.3.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

typescript-eslint 8.71 declares a peer range of `<6.1.0`. TypeScript 7, the native compiler, is released but not supported for type-aware linting, and the project relies on type-aware lint rules.

## Considered options

- Track the latest TypeScript.
- Pin TypeScript to 6.0.3 and let Dependabot surface the upgrade.
- Adopt TypeScript 7 and drop type-aware lint.

## Decision outcome

TypeScript is pinned to exactly 6.0.3. Dependabot ignores `typescript` at 6.1.0 and above until typescript-eslint supports it.

## Consequences

- Good: the toolchain stays inside every tool's supported range.
- Bad: the project does not use the native compiler yet.
- Revisit when typescript-eslint supports a newer TypeScript.
