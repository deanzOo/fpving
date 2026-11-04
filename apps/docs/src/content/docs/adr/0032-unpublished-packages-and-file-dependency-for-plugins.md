---
title: "0032. Unpublished packages, a file dependency for plugin authors and a first version of 0.1.0"
description: How the first release ships, how plugin authors get the SDK and why fpving starts at 0.1.0.
---

- Status: Accepted
- Date: 2026-11-04

## Context and problem statement

fpving is ready for its first release, and release-please was about to version it 1.0.0, its default for a package with no earlier release. The project is pre-1.0: interfaces can change. Users run the app from a clone. Plugin authors build against `@fpving/plugin-sdk`, which is private, so they need another way to get it.

## Considered options

- Publish `@fpving/plugin-sdk` and the app to npm. This gives authors a normal dependency, but it needs a registry account, a publish token and a release workflow with secrets, and it makes a pre-1.0 contract look stable while nothing else about running fpving comes from npm.
- Attach SDK and app tarballs to each GitHub Release. Nothing needs a registry, but the release workflow must build and upload them, and authors must then resolve versioned tarball URLs. The tarballs would not spare them a clone either, because the app still runs from one.
- Keep every package private, and have plugin authors use a `file:` dependency on `packages/plugin-sdk` in a built clone. There is nothing to publish or host, and authors already have the clone they test their plugin in.

## Decision outcome

Every package stays private and unpublished. A release is a Git tag and a GitHub Release per package from release-please. Plugin authors depend on `file:<clone>/packages/plugin-sdk`, and `main` in their `package.json` names their built ESM entry. npm links the folder and pnpm keeps its own copy; a walkthrough run with both found that either way the plugin's own folder resolves the SDK in the plugin's worker. The guide is [Writing a plugin](../../writing-a-plugin/).

The first release is 0.1.0, set with `initial-version` in `release-please-config.json`. `bump-minor-pre-major` keeps a breaking change at a minor bump until 1.0.

## Consequences

- Plugin authors need a built clone of fpving and must rebuild it to pick up SDK changes; with pnpm they also reinstall with `pnpm install --force`.
- The path in a plugin's `package.json` is specific to one machine, so a plugin's repository cannot install elsewhere without editing it.
- `initial-version` only applies while a package has no earlier release, so it has no effect after the first one.
- If authors outside this workflow appear, publishing the SDK can be decided in a new record.
