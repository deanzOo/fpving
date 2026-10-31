---
title: "0028. Product detail prices each snapshot"
description: The product detail answer carries each snapshot's landed cost, computed by core at read time, so the UI can show it and chart it.
---

- Status: Accepted
- Date: 2026-10-31
- Extends [ADR 0006](../0006-store-native-money-snapshots-and-read-time-fx/) to the product detail answer: snapshots stay store-native in storage, and their landed cost is computed at read time with today's rates, as the watchlist's is.

## Context and problem statement

The product page shows each listing's landed cost and a price history chart of it. Landed cost needs the settings (display currency, ship-to country, import tax) and the exchange rates, and no route exposes the rates, so the browser cannot compute it from the native prices the detail answer carried.

## Considered options

- Expose the exchange rates and compute landed cost in the UI. Rejected: the pricing rules would live twice, in core and in the browser.
- A separate price history route. Rejected: one more route and query for data the detail answer already lists.
- A `landedCost` on each history entry of the detail answer, computed by core. Chosen.

## Decision outcome

Core's `productDetail` reads the saved settings and the latest stored exchange rates and gives each snapshot `landedCost: Money | null` (`PricedSnapshot`). It applies the watchlist's rule: the exact landed cost in the display currency, rounded to a minor unit. It is null when shipping is unknown, a rate is missing, no rates are stored yet, or the snapshot was quoted for a ship-to country other than the saved one, because snapshots for different destinations are never compared. The route schema extends the snapshot schema with that field, and the generated reference shows it. Every landed cost uses today's rates, so a past point moves when rates move; the native prices underneath do not.

## Consequences

- Good: the product page shows and charts landed cost with no pricing logic of its own.
- Good: the same rule prices the watchlist and the detail, so their latest prices agree.
- Bad: the history is repriced on every read, over every snapshot of the product.
