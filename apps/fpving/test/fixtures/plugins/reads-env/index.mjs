export const manifest = {
  id: "env-shop",
  displayName: "Env Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["env.example"],
  capabilities: ["fetchListing"],
};

export const createStore = () => ({
  fetchListing: async () => ({
    ok: true,
    value: {
      title: `Variables: ${Object.keys(process.env).join() || "none"}`,
      itemPrice: { amountMinor: 1999, currency: "USD" },
      shipping: { kind: "unknown" },
      inStock: true,
      images: [],
    },
  }),
});
