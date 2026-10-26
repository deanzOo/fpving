---
title: "0012. semver for plugin manifest versions"
description: semver for plugin manifest versions.
---

- Status: Accepted
- Date: 2026-10-26

## Context and problem statement

A plugin manifest carries its own `version` and the `sdkVersion` range of `@fpving/plugin-sdk` it supports. The SDK must reject a malformed version or range when the manifest is parsed, and the host will later check the range against the running SDK. Semver ranges have a large grammar (`^`, `~`, `x`, hyphen ranges, `||`), so a hand-written pattern would be wrong at the edges.

## Considered options

- A hand-written regular expression.
- The `semver` package (ISC), the parser npm itself uses.
- A smaller alternative such as `compare-versions`, which does not parse full ranges.

## Decision outcome

`@fpving/plugin-sdk` depends on `semver`. It is called only from the internal module `packages/plugin-sdk/src/semver.ts`, which exposes `isSemverVersion` and `isSemverRange`, so swapping the library touches one file. It is a pure function library with no I/O, so it gets a thin internal wrapper rather than a domain port. `version` must be canonical: it must equal its parsed version plus any build metadata, so `1.2.3+build.1` passes and `v1.2.3` does not. `sdkVersion` must be a valid range in which every `||` alternative has an upper bound, found by inspecting the comparator sets `semver` expands a range into: a `<` or `<=` comparator, or an exact version, caret, tilde or x-range, which `semver` expands to one. That rejects `*`, `x`, `>=0.0.0`, `>0.0.0`, `>=1.0.0` and the empty string (`semver` reads it as `*`), because a plugin tested against one SDK release cannot vouch for every later one, and accepts `>=0.0.0 <1.0.0`, `^0.1.0`, `0.1.x` and `1.2.3`.

## Consequences

- Good: range validation matches what npm and pnpm accept.
- Good: the compatibility check in the planned loader can reuse the same wrapper.
- Bad: one more runtime dependency in a public package. It is small, has no dependencies and is maintained by the npm team.
