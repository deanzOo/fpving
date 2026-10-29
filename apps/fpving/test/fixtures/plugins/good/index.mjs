const manifest = {
  id: "good-shop",
  displayName: "Good Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["good.example"],
  capabilities: ["fetchListing", "search"],
};

export default {
  manifest,
  createStore: (ctx) => ({
    fetchListing: async (url) => {
      ctx.logger.info("fetching", { url });
      return {
        ok: true,
        value: {
          title: `Frame at ${url}`,
          itemPrice: { amountMinor: 1999, currency: ctx.currencyPreference },
          shipping: { kind: "unknown" },
          inStock: true,
          images: [],
        },
      };
    },
    search: async (query) => ({ ok: true, value: [{ url: "https://good.example/p/1", title: query.text }] }),
  }),
};
