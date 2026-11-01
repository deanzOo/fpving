// The E2E journey's source store: one listing with known shipping, so it has a landed cost; it cannot search.
export const manifest = {
  id: "source-shop",
  displayName: "Source Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["source.example"],
  capabilities: ["fetchListing"],
};

export const createStore = () => ({
  fetchListing: async () => ({
    ok: true,
    value: {
      title: "Acme Fixture Frame",
      itemPrice: { amountMinor: 2500, currency: "USD" },
      shipping: { kind: "known", amountMinor: 500, currency: "USD" },
      inStock: true,
      images: [],
    },
  }),
});
