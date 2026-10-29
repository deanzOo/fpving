import { ShippingUnknown } from "@fpving/plugin-sdk";
import type { FetchedListing, StoreResult } from "@fpving/plugin-sdk";
import { ok, pluginIdSchema } from "../src/index.ts";
import { describeStoreGatewayContract } from "../src/testing/index.ts";
import { fakeStoreGateway } from "./fakes/fake-store-gateway.ts";

const SHOP = pluginIdSchema.parse("example-shop");
const QUIET = pluginIdSchema.parse("quiet-shop");
const LISTING: StoreResult<FetchedListing> = ok({
  title: "Motor",
  itemPrice: { amountMinor: 1999, currency: "USD" },
  shipping: ShippingUnknown,
  inStock: true,
  images: [],
});

describeStoreGatewayContract(async () => Promise.resolve({
  gateway: fakeStoreGateway([
    { id: SHOP, domains: ["shop.example"], listing: LISTING, search: ok([{ url: "https://shop.example/2", title: "Motor" }]) },
    { id: QUIET, domains: ["quiet.example", "q.example"], listing: LISTING },
  ]),
  listingUrl: "https://shop.example/p/1",
  searchablePlugin: SHOP,
  fetchOnlyPlugin: QUIET,
  close: async () => Promise.resolve(),
}));
