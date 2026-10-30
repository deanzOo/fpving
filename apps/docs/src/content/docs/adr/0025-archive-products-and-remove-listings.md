---
title: "0025. Archive products, remove listings, and scan status from the schedule"
description: Deleting a product archives it and removing a listing marks it removed, so history is kept; the schedule says whether any scan runs.
---

- Status: Accepted
- Date: 2026-10-30
- Amends [ADR 0024](../0024-http-api-error-envelope-and-route-table/): adds the `restarting`, `alert_not_found` and `listing_not_found` kinds; an unknown alert no longer answers `not_found`, which now only means an unknown path.

## Context and problem statement

The API needs to delete a product and remove a listing, but snapshots, alerts and candidates reference both with `ON DELETE RESTRICT`, and the alert history is worth keeping. The scan status route could only see scans the API started, and a failed settings change left a dead plugin host behind.

## Considered options

- Hard delete, cascading to snapshots, alerts and candidates. Rejected: loses the price and alert history, and needs a decision for each referencing table.
- Archive the product (`archivedAt`, already in the schema) and mark a listing `removed`, a new `ListingStatus`. Chosen.

## Decision outcome

- `products.archive(id, at)` sets `archivedAt`. `products.list()` and every product route leave an archived product out: its detail, candidates, rename, search, listing removal and a second delete answer 404 `product_not_found`. `products.get` still reads it, because a scan running when it was archived must finish. No schema change.
- `listings.remove(productId, id)` marks the listing `removed` and clears the product's cheapest listing when it was this one, in one step. Migration 0001 widens the status check. A removed listing is never scanned, never the cheapest and never kept as the cheapest, and a scan already running cannot set it back to active. The product's detail leaves it out.
- `SchedulerHandle` gains `scanning()` and `lastReport()`, which cover scheduled, boot and on-demand scans. `GET /api/scan` reads them and scan now answers 409 `scan_running` while any scan runs.
- A settings change starts the new plugin host before it saves anything or shuts the old one down, so a failed start leaves the app as it was and the same change can be retried. Routes that need the plugins or the schedule answer 503 `restarting` while a change restarts them.
- Creating a product stays URL-only.

## Consequences

- Good: no history is lost, and both operations are a single atomic update.
- Good: one rule for 409 whatever started the running scan.
- Bad: archived products and removed listings stay in the database forever; there is no purge.
- Bad: the last scan's report lives in the schedule, so a settings change that restarts the schedule forgets it until the next scan.
