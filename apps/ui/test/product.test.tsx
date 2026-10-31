import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { listingIdSchema, ListingOrigin, ListingStatus, pluginIdSchema, snapshotIdSchema } from "@fpving/core";
import type { Listing } from "@fpving/core";
import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { z } from "zod";
import { takeLogged } from "./support/console-guard.ts";
import {
  alreadyTracked, at, failWith, fakeApi, noContent, product, reply, wire,
} from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

type Detail = z.output<typeof wire.detail>;
type Priced = Detail["listings"][number]["history"][number];

const ID = "p1";
const PAGE = "https://mall.example/item/frame";
const PRICE_MINOR = 12_345;
const SHIPPING_MINOR = 1500;
const OLDER_MINOR = 13_000;
const DAY_MS = 86_400_000;
const TWO_DAYS = 2;
const LANDED_MINOR = 13_845;
const LANDED_BEFORE_MINOR = 15_000;
const LOWER_MINOR = 12_000;
const DAYS = 6;
const SERIES_LIMIT = 8;

const listing = (id: string, overrides: Partial<Listing> = {}): Listing => ({
  id: listingIdSchema.parse(id), productId: product(ID, "x").id, pluginId: pluginIdSchema.parse("shop"),
  url: `https://shop.example/${id}`, title: `Acme X5 frame at ${id}`, status: ListingStatus.Active,
  origin: ListingOrigin.Manual, addedAt: new Date(0), failureStreak: 0, notFoundStreak: 0, ...overrides,
});

const snapshot = (listingId: string, daysAgo: number, overrides: Partial<Priced> = {}): Priced => ({
  id: snapshotIdSchema.parse(`${listingId}-${String(daysAgo)}`), listingId: listingIdSchema.parse(listingId),
  observedAt: new Date(Date.now() - daysAgo * DAY_MS), shipTo: "IL",
  itemPrice: { amountMinor: PRICE_MINOR, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING_MINOR, currency: "USD" }, inStock: true,
  landedCost: null, ...overrides,
});

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" } as const);

const detail = (): Detail => ({
  product: product(ID, "Acme X5 frame"),
  listings: [
    {
      listing: listing("l1"),
      history: [
        snapshot("l1", TWO_DAYS, { itemPrice: usd(OLDER_MINOR), landedCost: usd(LANDED_BEFORE_MINOR) }),
        snapshot("l1", 0, { landedCost: usd(LANDED_MINOR) }),
      ],
    },
    {
      listing: listing("l2", { pluginId: pluginIdSchema.parse("mall"), status: ListingStatus.Stale }),
      history: [snapshot("l2", 1, { shipping: { kind: ShippingKind.Unknown }, inStock: false })],
    },
  ],
});

const scripted = (shown: Detail = detail()) => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
  api.on(apiRoutes.getScan, reply(wire.scan, { running: false, latestRun: null, lastResult: null }));
  api.on(at(apiRoutes.getProduct, { productId: ID }), reply(wire.detail, shown));
  return api;
};

const open = async (api = scripted()) => {
  const screen = await renderApp(api.client, `/products/${ID}`);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Acme X5 frame" })).toBeVisible();
  return screen;
};

const renamed = (name: string): Detail => ({ ...detail(), product: { ...detail().product, name } });

describe("Product detail", () => {
  it("lists each listing with its store, latest native price, shipping, stock and status", async () => {
    const screen = await open();
    const first = screen.getByRole("row", { name: /^shop/u });
    await expect.element(first.getByRole("cell", { name: "$123.45" })).toBeVisible();
    await expect.element(first.getByRole("cell", { name: "$15.00" })).toBeVisible();
    await expect.element(first.getByRole("cell", { name: "In stock" })).toBeVisible();
    await expect.element(first.getByRole("cell", { name: "active" })).toBeVisible();
    await expect.element(first.getByRole("link", { name: "Acme X5 frame at l1" }))
      .toHaveAttribute("href", "https://shop.example/l1");
    const second = screen.getByRole("row", { name: /^mall/u });
    await expect.element(second.getByRole("cell", { name: "Unknown" })).toBeVisible();
    await expect.element(second.getByRole("cell", { name: "Out of stock" })).toBeVisible();
    await expect.element(second.getByRole("cell", { name: "stale" })).toBeVisible();
  });

  it("shows each listing's latest landed cost, or says it cannot be priced", async () => {
    const screen = await open();
    await expect.element(screen.getByRole("row", { name: /^shop/u }).getByRole("cell", { name: "$138.45" }))
      .toBeVisible();
    await expect.element(screen.getByRole("row", { name: /^mall/u }).getByRole("cell", { name: "Not priced" }))
      .toBeVisible();
  });

  it("renames the product through an inline form and focuses the rename action again", async () => {
    const api = scripted();
    api.on(at(apiRoutes.renameProduct, { productId: ID }), () => {
      api.on(at(apiRoutes.getProduct, { productId: ID }), reply(wire.detail, renamed("Acme X5 frame v2")));
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Rename" }).click();
    const field = screen.getByLabelText("Product name");
    await expect.element(field).toHaveFocus();
    await expect.element(field).toHaveValue("Acme X5 frame");
    await field.fill("Acme X5 frame v2");
    await screen.getByRole("button", { name: "Save name" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Acme X5 frame v2" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
    expect(api.sent)
      .toContainEqual({ method: "PATCH", path: `/api/products/${ID}`, body: { name: "Acme X5 frame v2" } });
  });

  it("drops the rename form on cancel", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Rename" }).click();
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect.element(screen.getByLabelText("Product name")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
  });

  it("explains a refused rename", async () => {
    const api = scripted();
    api.on(at(apiRoutes.renameProduct, { productId: ID }),
      failWith(HttpStatus.BadRequest, ApiErrorKind.InvalidRequest, "body/name too long"));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Rename" }).click();
    await screen.getByRole("button", { name: "Save name" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("body/name too long");
  });

  it("asks before it stops watching, and keeps watching on cancel with focus back on the action", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Stop watching" }).click();
    const dialog = screen.getByRole("dialog", { name: "Stop watching Acme X5 frame? Its price history is kept." });
    await expect.element(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Stop watching" })).toHaveFocus();
  });

  it("stops watching once confirmed and goes back to the watchlist with focus on its content", async () => {
    const api = scripted();
    api.on(at(apiRoutes.archiveProduct, { productId: ID }), noContent);
    const screen = await open(api);
    await screen.getByRole("button", { name: "Stop watching" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Stop watching" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await expect.element(screen.getByRole("main")).toHaveFocus();
    expect(api.sent).toContainEqual({ method: "DELETE", path: `/api/products/${ID}`, body: undefined });
  });

  it("explains a refused stop watching", async () => {
    const api = scripted();
    api.on(at(apiRoutes.archiveProduct, { productId: ID }),
      failWith(HttpStatus.NotFound, ApiErrorKind.ProductNotFound, "no product has this id"));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Stop watching" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Stop watching" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("This product is not watched any more.");
  });

  it("removes a listing once confirmed and moves focus to the listings heading", async () => {
    const api = scripted();
    api.on(at(apiRoutes.removeListing, { productId: ID, listingId: "l2" }), () => {
      const shown = detail();
      const kept = { ...shown, listings: shown.listings.slice(0, 1) };
      api.on(at(apiRoutes.getProduct, { productId: ID }), reply(wire.detail, kept));
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove the mall listing" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.element(screen.getByRole("row", { name: /^mall/u })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("heading", { level: 2, name: "Listings" })).toHaveFocus();
  });

  it("explains a refused listing removal", async () => {
    const api = scripted();
    api.on(at(apiRoutes.removeListing, { productId: ID, listingId: "l2" }),
      failWith(HttpStatus.NotFound, ApiErrorKind.ListingNotFound, "the product has no listing with this id"));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove the mall listing" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("the product has no listing with this id");
  });

  it("adds a listing by URL and shows it", async () => {
    const api = scripted();
    const added = wire.addedListing.parse({ listing: listing("l3", { url: PAGE }), snapshot: snapshot("l3", 0) });
    api.on(at(apiRoutes.addListing, { productId: ID }), () => {
      const shown = detail();
      api.on(at(apiRoutes.getProduct, { productId: ID }), reply(wire.detail, {
        ...shown,
        listings: [...shown.listings, { listing: added.listing, history: [{ ...added.snapshot, landedCost: null }] }],
      }));
      return reply(wire.addedListing, added, HttpStatus.Created)();
    });
    const screen = await open(api);
    await screen.getByLabelText("Store URL").fill(PAGE);
    await screen.getByRole("button", { name: "Add listing" }).click();
    await expect.element(screen.getByRole("status").filter({ hasText: "Now also" }))
      .toHaveTextContent("Now also watching Acme X5 frame at l3");
    await expect.element(screen.getByRole("link", { name: "Acme X5 frame at l3" })).toBeVisible();
    expect(api.sent).toContainEqual({ method: "POST", path: `/api/products/${ID}/listings`, body: { url: PAGE } });
  });

  it.each([
    ["product_not_found", failWith(HttpStatus.NotFound, ApiErrorKind.ProductNotFound, "no product has this id"),
      "This product is not watched any more."],
    ["already_tracked", alreadyTracked("p2", "Acme X5 kit"), "Already watched as Acme X5 kit"],
  ])("explains a %s refusal of an added listing", async (_kind, answer, said) => {
    const api = scripted();
    api.on(at(apiRoutes.addListing, { productId: ID }), answer);
    const screen = await open(api);
    await screen.getByLabelText("Store URL").fill(PAGE);
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("alert")).toHaveTextContent(said);
  });

  it("shows a not found state for a product that is not watched", async () => {
    const api = scripted();
    api.on(at(apiRoutes.getProduct, { productId: ID }),
      failWith(HttpStatus.NotFound, ApiErrorKind.ProductNotFound, "no product has this id"));
    const screen = await renderApp(api.client, `/products/${ID}`);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Product not found" })).toBeVisible();
    await screen.getByRole("link", { name: "Back to the watchlist" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
  });

  it("leaves any other failure to the error view", async () => {
    const api = scripted();
    api.on(at(apiRoutes.getProduct, { productId: ID }),
      failWith(HttpStatus.ServiceUnavailable, ApiErrorKind.Starting, "fpving is starting"));
    const screen = await renderApp(api.client, `/products/${ID}`);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
    expect(takeLogged().flat()).toContainEqual(expect.objectContaining({ kind: ApiErrorKind.Starting }));
  });
});

const daily = (listingId: string, landed: readonly (number | null)[]): Priced[] =>
  landed.map((amountMinor, index) => snapshot(listingId, landed.length - 1 - index, {
    landedCost: amountMinor === null ? null : usd(amountMinor),
  }));

const charted = (series: readonly (readonly (number | null)[])[]): Detail => ({
  product: product(ID, "Acme X5 frame"),
  listings: series.map((landed, index) => {
    const id = `l${String(index + 1)}`;
    const pluginId = pluginIdSchema.parse(`store${String(index + 1)}`);
    return { listing: listing(id, { pluginId }), history: daily(id, landed) };
  }),
});

const chartOf = (screen: Awaited<ReturnType<typeof open>>) =>
  screen.getByRole("application", { name: /^Landed cost over the last/u });

const curves = (container: Element) => [...container.querySelectorAll(".recharts-line-curve")]
  .map((curve) => (curve.getAttribute("d") ?? "").split("M").length - 1);

describe("Price history chart", () => {
  const steady = [LANDED_BEFORE_MINOR, LANDED_BEFORE_MINOR, null, LANDED_MINOR, LANDED_MINOR, LANDED_MINOR];
  const other = [LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR];

  it("draws one line per listing with a legend, and names each listing's range for screen readers", async () => {
    const screen = await open(scripted(charted([steady, other])));
    const name = `Landed cost over the last ${String(DAYS)} days: store1 lowest $138.45, highest $150.00, `
      + "latest $138.45; store2 lowest $120.00, highest $120.00, latest $120.00";
    await expect.element(screen.getByRole("application", { name })).toBeVisible();
    const legend = screen.getByRole("figure", { name: "Price history" }).getByRole("list", { name: "Legend" });
    await expect.element(legend.getByText("store1", { exact: true })).toBeVisible();
    await expect.element(legend.getByText("store2", { exact: true })).toBeVisible();
    expect(curves(chartOf(screen).element())).toHaveLength(TWO_DAYS);
  });

  it("leaves a gap over a day without a landed cost instead of bridging it", async () => {
    const screen = await open(scripted(charted([steady])));
    await expect.element(chartOf(screen)).toBeVisible();
    expect(curves(chartOf(screen).element())).toEqual([TWO_DAYS]);
  });

  it("draws a landed cost with no priced neighbour as a dot", async () => {
    const screen = await open(scripted(charted([[LANDED_MINOR, null, LANDED_MINOR, null, null, null]])));
    await expect.element(chartOf(screen)).toBeVisible();
    expect(chartOf(screen).element().querySelectorAll(".history-dot")).toHaveLength(TWO_DAYS);
  });

  it("lets the keyboard reach the chart and step through the days to read every listing's cost", async () => {
    const screen = await open(scripted(charted([steady, other])));
    chartOf(screen).element().focus();
    await expect.element(chartOf(screen)).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByText(/^store2 \$120\.00$/u)).toBeVisible();
  });

  it("says a listing had no price on a day the keyboard steps to", async () => {
    const lateOnly = [null, null, null, null, null, LANDED_MINOR];
    const screen = await open(scripted(charted([lateOnly, other])));
    chartOf(screen).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByText(/^store1 No price$/u)).toBeVisible();
  });

  it("says when no listing has a landed cost to chart", async () => {
    const screen = await open(scripted(charted([[null, null]])));
    await expect.element(screen.getByText("No landed cost to chart yet.")).toBeVisible();
  });

  it("charts only the first eight listings and says so, since the palette has eight series", async () => {
    const screen = await open(scripted(charted(Array.from({ length: SERIES_LIMIT + 1 }, () => other))));
    await expect.element(screen.getByText("The chart shows the first 8 of 9 listings; the table lists them all."))
      .toBeVisible();
    expect(curves(chartOf(screen).element())).toHaveLength(SERIES_LIMIT);
  });
});
