export const manifest = {
  id: "capable-shop",
  displayName: "Capable Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["capable.example"],
  capabilities: ["fetchListing"],
};

export const createStore = (ctx) => ({
  fetchListing: async (url) => {
    const response = await ctx.http.get(url, { headers: { accept: "text/html" } });
    if (!response.ok) return response;
    const page = await ctx.browser.fetchPage(url);
    if (!page.ok) return page;
    ctx.logger.warn("fetched", { status: page.value.status });
    return {
      ok: true,
      value: {
        title: `${response.value.body} / ${page.value.html}`,
        itemPrice: { amountMinor: 500, currency: "EUR" },
        shipping: { kind: "known", amountMinor: 0, currency: "EUR" },
        inStock: ctx.clock.now() instanceof Date,
        images: [page.value.finalUrl],
      },
    };
  },
});
