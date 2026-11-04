---
title: "0034. A workspace-wide license check on pnpm's own listing"
description: Why the license check reads pnpm licenses list and what the allowlist admits.
---

- Status: Accepted
- Date: 2026-11-04

## Context and problem statement

`license-checker-rseidelsohn` only scanned the root package's dependencies, so nothing checked react, fastify or anything else a workspace package uses. Two licenses outside the allowlist had already arrived unnoticed.

## Considered options

- Keep the checker and run it once per workspace package. It keeps a dependency with a large tree and needs a loop over packages.
- Read `pnpm licenses list -r --json`, which pnpm already provides for the whole workspace, and compare it with an allowlist in `tools/license-check.ts`.

## Decision outcome

`pnpm licenses:check` pipes pnpm's listing into `tools/license-check-cli.ts`, and `license-checker-rseidelsohn` is removed. An empty or unreadable listing fails the check. The allowlist gains two licenses:

- `OFL-1.1`: the design system's fonts, which ship in the UI.
- `LGPL-3.0-or-later`: `@img/sharp-libvips`, pulled in by the docs site's build. It is compatible with AGPL-3.0, and it is not shipped in the app.

## Consequences

- Good: every external dependency of every workspace package is checked, dev dependencies included.
- Bad: pnpm lists what is installed for the current platform, so a platform-specific package on another OS is not seen. CI runs this check on Linux.
- Bad: licenses are compared as exact strings, so a new combined expression of allowed licenses fails until it is added. That is deliberate: a person reads it first.
