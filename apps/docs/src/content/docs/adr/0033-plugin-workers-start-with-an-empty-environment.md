---
title: "0033. Plugin workers start with an empty environment"
description: Why a plugin's process.env holds none of the host's variables.
---

- Status: Accepted
- Date: 2026-11-04

## Context and problem statement

A Node worker gets a copy of the parent's `process.env` by default, so every plugin could read `ANTHROPIC_API_KEY` and anything else set in the host's shell. Plugins are trusted ([ADR 0004](../0004-worker-thread-plugin-isolation/)), but none of them needs those values.

## Considered options

- Keep the inherited environment and rely on trust. A plugin bug or a dependency that logs its environment could still leak a host secret.
- Pass an allowlist of variables. The list would have to name something, and no plugin needs any of it: the host provides HTTP, the browser and the logger.
- Pass an empty environment.

## Decision outcome

`spawnWorker` starts every worker with `env: {}`.

## Consequences

- Good: a host secret in the environment never reaches a plugin.
- Bad: a plugin cannot be configured through environment variables. One that needs a secret reads its own file.
- This is not a sandbox. A plugin can still read files, such as the app's `.env`, so install only plugins you trust.
