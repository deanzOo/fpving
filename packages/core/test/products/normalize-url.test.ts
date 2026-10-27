import { describe, expect, it } from "vitest";
import { AddErrorKind, err, normalizeListingUrl, ok } from "../../src/index.ts";

const DOMAINS = ["shop.example", "aliexpress.com"];

const normalized = (url: string): unknown => normalizeListingUrl(url, DOMAINS);

describe("Normalizing a listing URL", () => {
  it("lowercases the scheme and host but keeps the path's case", () => {
    expect(normalized("HTTPS://Shop.EXAMPLE/Item/ABC")).toEqual(ok("https://shop.example/Item/ABC"));
  });

  it("drops the fragment", () => {
    expect(normalized("https://shop.example/item#reviews")).toEqual(ok("https://shop.example/item"));
  });

  it("drops utm_, affiliate and click-id tracking parameters and keeps the rest", () => {
    const tracked = "https://shop.example/item?utm_source=a&utm_campaign=b&gclid=c&fbclid=d&msclkid=e"
      + "&spm=f&scm=g&aff_fcid=h&aff_trace_key=i&sku=42";
    expect(normalized(tracked)).toEqual(ok("https://shop.example/item?sku=42"));
  });

  it("keeps parameters that only resemble tracking ones", () => {
    expect(normalized("https://shop.example/item?utm=1&spmx=2&affiliate=3")).toEqual(
      ok("https://shop.example/item?affiliate=3&spmx=2&utm=1"),
    );
  });

  it("sorts the remaining parameters so their order does not matter", () => {
    expect(normalized("https://shop.example/item?variant=red&sku=42")).toEqual(
      ok("https://shop.example/item?sku=42&variant=red"),
    );
  });

  it("drops the question mark when no parameter is left", () => {
    expect(normalized("https://shop.example/item?utm_source=a")).toEqual(ok("https://shop.example/item"));
    expect(normalized("https://shop.example/item?")).toEqual(ok("https://shop.example/item"));
  });

  it("strips trailing slashes from the path but keeps the root", () => {
    expect(normalized("https://shop.example/item/")).toEqual(ok("https://shop.example/item"));
    expect(normalized("https://shop.example/")).toEqual(ok("https://shop.example/"));
    expect(normalized("https://shop.example")).toEqual(ok("https://shop.example/"));
  });

  it("drops the default port", () => {
    expect(normalized("https://shop.example:443/item")).toEqual(ok("https://shop.example/item"));
  });

  it("strips a www. or m. subdomain when the remaining host is a declared plugin domain", () => {
    expect(normalized("https://www.shop.example/item")).toEqual(ok("https://shop.example/item"));
    expect(normalized("https://m.shop.example/item")).toEqual(ok("https://shop.example/item"));
  });

  it("keeps a www. or m. subdomain when the remaining host is not a declared plugin domain", () => {
    expect(normalized("https://www.other.example/item")).toEqual(ok("https://www.other.example/item"));
    expect(normalized("https://m.other.example/item")).toEqual(ok("https://m.other.example/item"));
  });

  it("keeps any other subdomain", () => {
    expect(normalized("https://de.shop.example/item")).toEqual(ok("https://de.shop.example/item"));
  });

  it("gives a mobile, tracked AliExpress link the same URL as the plain desktop one", () => {
    const shared = "https://M.AliExpress.com/item/1005001.html?spm=a2g0o.home&utm_medium=cpc&aff_fsk=x#nav";
    const plain = "https://aliexpress.com/item/1005001.html";
    expect(normalized(shared)).toEqual(ok(plain));
    expect(normalized(plain)).toEqual(ok(plain));
  });

  it("refuses a string that is not a URL", () => {
    expect(normalized("not a url")).toEqual(err({ kind: AddErrorKind.InvalidUrl }));
  });

  it("refuses a URL whose scheme is not http or https", () => {
    expect(normalized("ftp://shop.example/item")).toEqual(err({ kind: AddErrorKind.InvalidUrl }));
    expect(normalized("javascript:alert(1)")).toEqual(err({ kind: AddErrorKind.InvalidUrl }));
  });
});
