---
title: "0006. Store-native money snapshots and read-time FX"
description: Store-native money snapshots and read-time FX.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Prices come in many currencies and exchange rates move. Storing converted amounts would bake in stale rates and make a currency change rewrite history. Floats cannot represent money exactly.

## Considered options

- Store amounts converted to the display currency at scan time.
- Store store-native amounts and convert when reading.
- Store floats.

## Decision outcome

Money is `{ amountMinor: integer, currency }`. Price snapshots are append-only and hold store-native amounts only. Conversion to the display currency happens at read time with the current rate. Snapshots are tagged with the ship-to country and snapshots for different destinations are never compared. Unknown shipping is never treated as zero.

## Consequences

- Good: changing the display currency needs no migration and shows no stale data.
- Good: a price-drop alert compares in the listing's own currency, so exchange-rate moves never fake a drop.
- Bad: every read converts, so cross-store views depend on a recent rate.
- If no rate was ever fetched, prices show in their native currency only and are excluded from cross-store comparison.
