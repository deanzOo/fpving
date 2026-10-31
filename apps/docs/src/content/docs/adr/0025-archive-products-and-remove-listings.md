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

## Amendment, 2026-10-30: archived products refuse new listings, and re-adding a URL restores it

- Adding a listing to an archived product, or accepting one of its candidates, answers 404 `product_not_found`. `listings.addWithSnapshot` and `matchCandidates.accept` refuse an archived product with `not_found` in the same step as the insert, so an archive during the store fetch is caught too.
- Archive and remove keep the listing row, and listing URLs stay unique, so a deleted product or a removed listing used to be a dead end: its URL answered 409 forever. Re-adding the URL now restores it. Considered: leaving archived and removed rows out of the uniqueness check, which needs a schema change, and only explaining the 409, which leaves the dead end. Chosen: restore on re-add.
  - Adding a product with the URL of a listing of an archived product fetches it again and, in one step (`products.restore`), un-archives the product, makes that listing active with no failures and appends the new snapshot. Its history, candidates and alerts are kept.
  - Adding the URL of a removed listing to that listing's own product does the same for the listing (`listings.restore`).
  - A URL tracked by any other listing answers 409 `already_tracked`, naming that product by id and name. That includes a removed listing of another product and a listing of an archived product added to a different product.
  - No schema change.
- A scan running while a listing is removed or a product archived leaves that listing, or the whole product, out of its cheapest listing and its alerts.
- A settings change that starts a new plugin host now saves the settings before the gateway moves to the new host, so a failed save shuts the new host down and leaves the app as it was. Calls still running through the old gateway get up to five seconds to finish before the old host shuts down, and an old host that fails to shut down is logged as a warning while the change succeeds.
- Good: deleting or removing by mistake is undone by pasting the URL again.
- Bad: a listing can only move between products by being restored on its own product; there is no move.

## Amendment, 2026-10-31: typed settings failures and the shutdown window

- Amends [ADR 0024](../0024-http-api-error-envelope-and-route-table/): adds the `settings_not_applied` and `shutting_down` kinds, both 503.
- A settings change whose new plugin host fails to start, or whose settings fail to save, answers 503 `settings_not_applied` instead of 500, since it is an expected failure, not a bug. The cause is logged as an error; a new host that then fails to shut down is logged as a warning and does not replace that cause.
- Shutdown stops the schedule before it closes the server, so for a moment the server still answers. In that window a settings change and scan now answer 503 `shutting_down` instead of 500 or a 202 for a scan that never starts.
- Calls on the old gateway that outlast the five-second drain are logged as their own warning, not as a missed shutdown deadline.
