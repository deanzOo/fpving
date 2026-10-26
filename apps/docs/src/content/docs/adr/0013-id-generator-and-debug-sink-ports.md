---
title: "0013. IdGenerator and DebugSink ports"
description: IdGenerator and DebugSink ports.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

[ADR 0005](../0005-ports-and-adapters-for-dependencies/) lists the ports the domain needs. Building the core entities surfaced two more runtime dependencies: minting entity ids, which is random or time based and so makes tests non-deterministic, and saving the raw page of a `parse_failed` fetch to disk.

## Considered options

- Mint ids inside each repository adapter and write debug pages from the scan code with `node:fs`.
- Put both behind domain ports with in-memory fakes, like every other runtime dependency.

## Decision outcome

Core defines `IdGenerator` (`next(): string`, parsed with the matching branded id schema) and `DebugSink` (`savePage(pluginId, url, html)`). The domain creates entities with their ids before handing them to the `Repository`, so every adapter stores ids it is given. Default adapters come with the host app.

## Consequences

- Good: tests get deterministic ids and never touch the file system.
- Good: the SQLite adapter does not decide id format.
- Bad: two more small interfaces to maintain.
