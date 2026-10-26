import { ShippingKind } from "@fpving/plugin-sdk";
import {
  listingIdSchema,
  ListingOrigin,
  ListingStatus,
  productIdSchema,
  snapshotIdSchema,
} from "../../src/index.ts";
import type { Listing, PriceSnapshot } from "../../src/index.ts";
import type { AlertSettings, ListingWithLatest } from "../../src/alerts/draft.ts";
import type { FxTable } from "../../src/pricing/fx.ts";
import { ThresholdBasis } from "../../src/pricing/import-tax.ts";

const MS_PER_DAY = 86_400_000;
const NOW_ISO = "2026-10-27T00:00:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const DUTY_FREE_USD = 7500;
const NO_VAT = 0;
const FIVE_PERCENT = 500;
const ILS_PER_USD = 3.6;
const OLD_DAYS = 100;
const DEFAULT_PRICE = 10_000;

export const NOW = new Date(NOW_MS);

export const daysAgo = (days: number): Date => new Date(NOW_MS - days * MS_PER_DAY);

export const rates: FxTable = { base: "USD", ratesPerBase: { ILS: ILS_PER_USD }, fetchedOn: "2026-10-27" };

export const settings: AlertSettings = {
  displayCurrency: "USD",
  importTax: {
    dutyFreeThreshold: { amountMinor: DUTY_FREE_USD, currency: "USD" },
    vatBasisPoints: NO_VAT,
    thresholdBasis: ThresholdBasis.Item,
  },
  priceDropMinBasisPoints: FIVE_PERCENT,
};

export const listing = (id: string, overrides: Partial<Listing> = {}): Listing => ({
  id: listingIdSchema.parse(id),
  productId: productIdSchema.parse("p1"),
  pluginId: "store",
  url: `https://store.example/${id}`,
  title: id,
  status: ListingStatus.Active,
  origin: ListingOrigin.Manual,
  addedAt: daysAgo(OLD_DAYS),
  failureStreak: 0,
  notFoundStreak: 0,
  ...overrides,
});

export const snapshot = (id: string, listingId: string, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot => ({
  id: snapshotIdSchema.parse(id),
  listingId: listingIdSchema.parse(listingId),
  observedAt: daysAgo(1),
  shipTo: "IL",
  itemPrice: { amountMinor: DEFAULT_PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: 0, currency: "USD" },
  inStock: true,
  ...overrides,
});

export const withLatest = (l: Listing, latest: PriceSnapshot): ListingWithLatest => ({ listing: l, latest });
