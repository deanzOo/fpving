import { fxTableSchema, matchCandidateSchema, priceSnapshotSchema, settingsSchema } from "@fpving/core";
import type { FxTable, MatchCandidate, PriceSnapshot, Settings } from "@fpving/core";
import { ShippingKind } from "@fpving/plugin-sdk";
import { SETTINGS_ROW_ID } from "./schema.js";
import type { fxTables, matchCandidates, priceSnapshots, settings } from "./schema.js";

type SnapshotRow = typeof priceSnapshots.$inferSelect;
type CandidateRow = typeof matchCandidates.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;
type FxRow = typeof fxTables.$inferSelect;

export const toSnapshotRow = ({ itemPrice, shipping, ...rest }: PriceSnapshot): SnapshotRow => ({
  ...rest,
  itemAmountMinor: itemPrice.amountMinor,
  itemCurrency: itemPrice.currency,
  shippingKind: shipping.kind,
  shippingAmountMinor: shipping.kind === ShippingKind.Known ? shipping.amountMinor : null,
  shippingCurrency: shipping.kind === ShippingKind.Known ? shipping.currency : null,
});

export const fromSnapshotRow = (row: SnapshotRow): PriceSnapshot =>
  priceSnapshotSchema.parse({
    ...row,
    itemPrice: { amountMinor: row.itemAmountMinor, currency: row.itemCurrency },
    shipping: row.shippingKind === ShippingKind.Unknown
      ? { kind: row.shippingKind }
      : { kind: row.shippingKind, amountMinor: row.shippingAmountMinor, currency: row.shippingCurrency },
  });

export const toCandidateRow = ({ similarityScore, ...rest }: MatchCandidate): CandidateRow => ({
  ...rest,
  similarity: similarityScore,
});

export const fromCandidateRow = ({ similarity, ...rest }: CandidateRow): MatchCandidate =>
  matchCandidateSchema.parse({ ...rest, similarityScore: similarity });

export const toSettingsRow = ({ importTax, ...rest }: Settings): SettingsRow => ({
  ...rest,
  id: SETTINGS_ROW_ID,
  dutyFreeAmountMinor: importTax.dutyFreeThreshold.amountMinor,
  dutyFreeCurrency: importTax.dutyFreeThreshold.currency,
  vatBasisPoints: importTax.vatBasisPoints,
  thresholdBasis: importTax.thresholdBasis,
});

export const fromSettingsRow = (row: SettingsRow): Settings =>
  settingsSchema.parse({
    ...row,
    importTax: {
      dutyFreeThreshold: { amountMinor: row.dutyFreeAmountMinor, currency: row.dutyFreeCurrency },
      vatBasisPoints: row.vatBasisPoints,
      thresholdBasis: row.thresholdBasis,
    },
  });

export const toFxRow = ({ ratesPerBase, ...rest }: FxTable): Omit<FxRow, "id"> => ({
  ...rest,
  ratesJson: ratesPerBase,
});

export const fromFxRow = ({ ratesJson, ...rest }: FxRow): FxTable =>
  fxTableSchema.parse({ ...rest, ratesPerBase: ratesJson });
