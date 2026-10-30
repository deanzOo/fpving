import { ShippingUnknown } from "@fpving/plugin-sdk";
import type { FetchedListing, StoreResult } from "@fpving/plugin-sdk";
import { ok, pluginIdSchema } from "../src/index.ts";
import { describeStoreGatewayContract } from "../src/testing/index.ts";
import { fakeStoreGateway } from "./fakes/fake-store-gateway.ts";

const SHOP = pluginIdSchema.parse("example-shop");
const QUIET = pluginIdSchema.parse("quiet-shop");
const DOWN = pluginIdSchema.parse("down-shop");
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
    { id: DOWN, domains: ["down.example"], listing: LISTING, search: ok([]), disabled: true },
  ]),
  listingUrl: "https://shop.example/p/1",
  searchablePlugin: SHOP,
  fetchOnlyPlugin: QUIET,
  disabledPlugin: DOWN,
  close: async () => Promise.resolve(),
}));
