// Test-only plugin for the static pages of test/support/local-server.ts; the origin comes from FPVING_FIXTURE_ORIGIN.
export const manifest = {
  id: "fixture-shop",
  displayName: "Fixture Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["127.0.0.1"],
  capabilities: ["fetchListing", "search"],
};

const NOT_FOUND = 404;
const TITLE = /<h1 class="title">([^<]+)<\/h1>/u;
const PRICE = /data-amount-minor="(\d+)" data-currency="([A-Z]{3})"/u;
const RESULT = /<a class="result" href="([^"]+)">([^<]+)<\/a>/gu;

const read = async (ctx, url) => {
  const response = await ctx.http.get(url, { headers: { accept: "text/html" } });
  if (!response.ok) return response;
  if (response.value.status === NOT_FOUND) return { ok: false, error: { kind: "not_found", detail: `${url} is gone` } };
  return { ok: true, value: response.value.body };
};

export const createStore = (ctx) => ({
  fetchListing: async (url) => {
    const page = await read(ctx, url);
    if (!page.ok) return page;
    const title = TITLE.exec(page.value)?.[1];
    const price = PRICE.exec(page.value);
    if (title === undefined || price === null) {
      return { ok: false, error: { kind: "parse_failed", detail: "no title or price", rawPage: page.value } };
    }
    return {
      ok: true,
      value: {
        title,
        itemPrice: { amountMinor: Number(price[1]), currency: price[2] },
        shipping: { kind: "unknown" },
        inStock: page.value.includes("In stock"),
        images: [],
      },
    };
  },
  search: async () => {
    const origin = process.env.FPVING_FIXTURE_ORIGIN ?? "";
    const page = await read(ctx, `${origin}/fixture/search`);
    if (!page.ok) return page;
    const candidates = [...page.value.matchAll(RESULT)].map(([, href, title]) => ({ url: new URL(href, origin).href, title }));
    return { ok: true, value: candidates };
  },
});
