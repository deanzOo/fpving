---
title: "0036. Snapshot ties follow append order, using SQLite's rowid"
description: Why snapshots observed at the same instant rank by when they were appended, and why no column records it.
---

- Status: Accepted
- Date: 2026-11-04

## Context and problem statement

Snapshots of one listing observed in the same millisecond were ranked by the greater id. Production ids are random UUIDs, so "latest" could be the older snapshot. Scans do not overlap today, so this has not happened, but the back in stock alert and the cheapest listing both rely on the order.

## Considered options

- A monotonic sequence column on `price_snapshots`, set on append. It states the order in the schema, but it costs a migration and a field the domain has no other use for.
- SQLite's rowid, which every append already assigns. No migration and no change to `PriceSnapshot`, but the order lives in an implicit column.

## Decision outcome

Of snapshots of one listing observed at the same instant, the later appended is the newest. The SQLite adapter orders ties on `rowid`, and the in-memory fake on insertion order. `SnapshotRepository` states the rule and the repository contract tests it.

## Consequences

- Good: no schema change, and the port no longer gives an id a meaning it does not have.
- Good: snapshots are append-only, so a new rowid is always above the existing ones.
- Bad: SQLite's documentation says `VACUUM` may change rowids of a table without an `INTEGER PRIMARY KEY`, as this one is. On the SQLite this project ships (3.53.4), `VACUUM` and `VACUUM INTO` kept them unchanged, and a test pins the order in a migration backup, so an upgrade that breaks it fails there.
- Bad: a future migration that rebuilds `price_snapshots` must copy rows in rowid order, which no constraint enforces.
