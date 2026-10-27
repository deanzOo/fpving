---
title: Configuration
description: Planned settings and plugin configuration.
---

:::caution[Planned]
No settings screen or config file exists yet. This page records the intended shape.
:::

## Settings

| Setting | Meaning |
| --- | --- |
| `displayCurrency` | ISO 4217 code prices are shown in, for example `ILS`. |
| `shipToCountry` | ISO 3166 country the landed cost is computed for, for example `IL`. |
| `importTax` | `{ dutyFreeThreshold, vatBasisPoints, thresholdBasis }`. VAT applies above the threshold, which may be zero to tax everything; `vatBasisPoints` is hundredths of a percent, so 1800 is 18%, and `thresholdBasis` says whether the threshold is compared with the item alone or with item plus shipping. |
| `scanIntervalHours` | How often listings are rescanned while the app runs. |
| `priceDropMinBasisPoints` | Minimum drop below the previous 30-day low to alert, in hundredths of a percent, so the default 500 is 5%. |

Country presets are a typed table. The first version ships Israel only: 18% VAT on item plus shipping once the item is above USD 75, per the Israel Tax Authority page recorded as the preset's source. Landed cost includes VAT only, not purchase tax or customs duty (which can apply to Israeli parcels above USD 500), and the preset is user-editable. Other countries are added by pull request; unknown countries are filled in by hand.

## Landed cost

`landed = item + shipping + importTax(item, shipping)`, shown in the display currency at the current exchange rate. The pricing code behind this exists and is tested; the settings screen does not. Unknown shipping is never treated as zero.

Changing `shipToCountry` invalidates shipping; the next scan refetches. Old snapshots are kept, tagged with their original destination, and snapshots for different destinations are never compared.

## Plugins

A typed `plugins.config.ts` lists plugin package names or local folder paths. See [Writing a plugin](../writing-a-plugin/).

## Secrets

The Anthropic API key used for matching is bring-your-own. `ANTHROPIC_API_KEY` is read from a local `.env` and is optional; error text and logs never contain it. The Anthropic `LlmJudge` adapter uses it, and `pnpm eval:matcher` reads it from the environment to run the matcher eval against the real model, which costs API credits; without it the eval is skipped. The app does not wire the adapter in yet. Once it does, candidates are saved unjudged without a key and adding products still works.
