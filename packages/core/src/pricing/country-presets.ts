import { ThresholdBasis } from "./import-tax.js";
import type { ImportTaxRule } from "./import-tax.js";

/** Where a preset's values came from and the date they were read, so stale rules can be spotted and rechecked. */
export interface PresetSource {
  url: string;
  retrievedOn: string;
}

/** A country's default import tax rule with the source it was taken from. */
export interface CountryPreset {
  importTax: ImportTaxRule;
  source: PresetSource;
}

/**
 * Import tax rules per destination country. Israel: personal imports are exempt when the goods value is at most
 * USD 75 (shipping and insurance excluded), otherwise 18% VAT applies to goods plus shipping. Purchase tax and
 * customs duty on parcels above USD 500 are not modelled, so landed cost for those is a lower bound.
 */
export const COUNTRY_PRESETS = {
  IL: {
    importTax: {
      dutyFreeThreshold: { amountMinor: 7500, currency: "USD" },
      vatBasisPoints: 1800,
      thresholdBasis: ThresholdBasis.Item,
    },
    source: {
      url: "https://www.gov.il/he/pages/customs-personal-import-general-info",
      retrievedOn: "2026-10-27",
    },
  },
} as const satisfies Record<string, CountryPreset>;
