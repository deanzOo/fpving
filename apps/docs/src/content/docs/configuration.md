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
| `importTax` | `{ dutyFreeThreshold, vatPercent }`. Import tax applies above the threshold. |
| `scanIntervalHours` | How often listings are rescanned while the app runs. |
| `priceDropMinPercent` | Minimum drop below the previous 30-day low to alert. Default 5. |

Country presets are a typed table. The first version ships Israel only, and the values must be verified against current rules before release. Other countries are added by pull request; unknown countries are filled in by hand.

## Landed cost

`landed = item + shipping + importTax(item + shipping)`, shown in the display currency at the current exchange rate. Unknown shipping is never treated as zero.

Changing `shipToCountry` invalidates shipping; the next scan refetches. Old snapshots are kept, tagged with their original destination, and snapshots for different destinations are never compared.

## Plugins

A typed `plugins.config.ts` lists plugin package names or local folder paths. See [Writing a plugin](../writing-a-plugin/).

## Secrets

The Anthropic API key used for matching is bring-your-own and lives in a local `.env`. Without a key, candidates are saved unjudged and adding products still works.
