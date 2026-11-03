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
  alreadyTracked, at, failWith, fakeApi, gate, noContent, product, reply, wire,
} from "./support/fake-api.ts";
import { curveSegments } from "./support/chart.ts";
import { renderApp } from "./support/render-app.tsx";
import { hasBrackets, rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

type Detail = z.output<typeof wire.detail>;
type Priced = Detail["listings"][number]["history"][number];

const ID = "p1";
const PAGE = "https://mall.example/item/frame";
const PRICE_MINOR = 12_345;
const SHIPPING_MINOR = 1500;
const OLDER_MINOR = 13_000;
const DAY_MS = 86_400_000;
const NOON = 12;
const DST_YEAR = 2026;
const DST_MONTH = 2;
const DST_DAY_BEFORE = 26;
const DST_DAY_AFTER = 28;
const TWO_DAYS = 2;
const LANDED_MINOR = 13_845;
const LANDED_BEFORE_MINOR = 15_000;
const LOWER_MINOR = 12_000;
const DAYS = 6;
const SERIES_LIMIT = 8;
const LATE_HOUR = 23;
const LATE_MINUTE = 50;
const EARLY_MINUTE = 10;

const listing = (id: string, overrides: Partial<Listing> = {}): Listing => ({
  id: listingIdSchema.parse(id), productId: product(ID, "x").id, pluginId: pluginIdSchema.parse("shop"),
  url: `https://shop.example/${id}`, title: `Acme X5 frame at ${id}`, status: ListingStatus.Active,
  origin: ListingOrigin.Manual, addedAt: new Date(0), failureStreak: 0, notFoundStreak: 0, ...overrides,
});

const localNoon = (daysAgo: number): Date => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, NOON);
};

const snapshot = (listingId: string, daysAgo: number, overrides: Partial<Priced> = {}): Priced => ({
  id: snapshotIdSchema.parse(`${listingId}-${String(daysAgo)}`), listingId: listingIdSchema.parse(listingId),
  observedAt: localNoon(daysAgo), shipTo: "IL",
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

const cheapestAt = (listingId: string): Detail => {
  const shown = detail();
  return { ...shown, product: { ...shown.product, cheapestListingId: listingIdSchema.parse(listingId) } };
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

  it("stops watching once confirmed and goes back to the watchlist without reading the product again", async () => {
    const api = scripted();
    api.on(at(apiRoutes.archiveProduct, { productId: ID }), noContent);
    const screen = await open(api);
    await screen.getByRole("button", { name: "Stop watching" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Stop watching" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await expect.element(screen.getByRole("main")).toHaveFocus();
    expect(api.sent).toContainEqual({ method: "DELETE", path: `/api/products/${ID}`, body: undefined });
    const archived = api.sent.findIndex(({ method }) => method === "DELETE");
    const reads = api.sent.slice(archived)
      .filter(({ method, path }) => method === "GET" && path === `/api/products/${ID}`);
    expect(reads).toEqual([]);
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
    await screen.getByRole("button", { name: "Remove mall: Acme X5 frame at l2" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.element(screen.getByRole("row", { name: /^mall/u })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("heading", { level: 2, name: "Listings" })).toHaveFocus();
  });

  it("tells two listings on the same store apart by store and title", async () => {
    const shown = detail();
    const twin = { listing: listing("l9", { title: "Acme X5 frame, black" }), history: [snapshot("l9", 0)] };
    const screen = await open(scripted({ ...shown, listings: [...shown.listings, twin] }));
    await expect.element(screen.getByRole("rowheader", { name: "shop: Acme X5 frame at l1" })).toBeVisible();
    await expect.element(screen.getByRole("rowheader", { name: "shop: Acme X5 frame, black" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Remove shop: Acme X5 frame at l1" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Remove shop: Acme X5 frame, black" })).toBeVisible();
    await expect.element(screen.getByRole("list", { name: "Legend" }).getByText("shop: Acme X5 frame at l1"))
      .toBeVisible();
  });

  it("explains a refused listing removal", async () => {
    const api = scripted();
    api.on(at(apiRoutes.removeListing, { productId: ID, listingId: "l2" }),
      failWith(HttpStatus.NotFound, ApiErrorKind.ListingNotFound, "the product has no listing with this id"));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove mall: Acme X5 frame at l2" }).click();
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

  it("features the cheapest listing's landed cost in the one framed panel", async () => {
    const screen = await open(scripted(cheapestAt("l1")));
    const cheapest = screen.getByRole("region", { name: "Cheapest landed" });
    await expect.element(cheapest.getByText("$138.45")).toBeVisible();
    await expect.element(cheapest.getByText("shop: Acme X5 frame at l1")).toBeVisible();
    expect(hasBrackets(cheapest)).toBe(true);
    expect(styleOf(cheapest.getByText("$138.45")).fontSize).toBe("20px");
  });

  it("features nothing while the cheapest listing has no landed cost", async () => {
    const screen = await open(scripted(cheapestAt("l2")));
    await expect.element(screen.getByRole("region", { name: "Cheapest landed" })).not.toBeInTheDocument();
  });

  it("shows each listing's status as a badge: active as live, stale as a warning with its glyph", async () => {
    const screen = await open();
    const active = screen.getByRole("row", { name: /^shop/u }).getByText("active", { exact: true });
    await expect.element(active).toBeVisible();
    expect(styleOf(active).color).toBe(rgb(token("--color-signal")));
    const stale = screen.getByRole("row", { name: /^mall/u }).getByText("stale", { exact: true });
    expect(styleOf(stale).color).toBe(rgb(token("--color-warning")));
    expect(stale.element().previousElementSibling?.textContent).toBe("▲");
  });

  it("sets each price in the readout face", async () => {
    const screen = await open();
    const price = screen.getByRole("row", { name: /^shop/u }).getByText("$123.45");
    await expect.element(price).toBeVisible();
    expect(styleOf(price).fontFamily).toContain("Martian Mono");
  });

  it("says Saving… on the save button while a rename is on its way", async () => {
    const api = scripted();
    const saved = gate();
    api.on(at(apiRoutes.renameProduct, { productId: ID }), async () => {
      await saved.opened;
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Rename" }).click();
    await screen.getByRole("button", { name: "Save name" }).click();
    await expect.element(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
    saved.release();
  });

  it("says Stopping… on its button while stop watching is on its way", async () => {
    const api = scripted();
    const stopped = gate();
    api.on(at(apiRoutes.archiveProduct, { productId: ID }), async () => {
      await stopped.opened;
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Stop watching" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Stop watching" }).click();
    await expect.element(screen.getByRole("button", { name: "Stopping…" })).toHaveAttribute("aria-disabled", "true");
    stopped.release();
  });

  it("says Removing… on the removed listing's button only, and holds the others meanwhile", async () => {
    const api = scripted();
    const removed = gate();
    api.on(at(apiRoutes.removeListing, { productId: ID, listingId: "l2" }), async () => {
      await removed.opened;
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove mall: Acme X5 frame at l2" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    const target = screen.getByRole("button", { name: "Remove mall: Acme X5 frame at l2" });
    await expect.element(target).toHaveTextContent("Removing…");
    const other = screen.getByRole("button", { name: "Remove shop: Acme X5 frame at l1" });
    await expect.element(other).toHaveTextContent("Remove");
    await expect.element(other).toHaveAttribute("aria-disabled", "true");
    removed.release();
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

describe("Price history chart", () => {
  const steady = [LANDED_BEFORE_MINOR, LANDED_BEFORE_MINOR, null, LANDED_MINOR, LANDED_MINOR, LANDED_MINOR];
  const other = [LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR, LOWER_MINOR];

  it("draws one line per listing with a legend, and names each listing's range for screen readers", async () => {
    const screen = await open(scripted(charted([steady, other])));
    const name = `Landed cost over the last ${String(DAYS)} days: store1: Acme X5 frame at l1 lowest $138.45, `
      + "highest $150.00, latest $138.45; store2: Acme X5 frame at l2 lowest $120.00, highest $120.00, latest $120.00";
    await expect.element(screen.getByRole("application", { name })).toBeVisible();
    const legend = screen.getByRole("figure", { name: "Price history" }).getByRole("list", { name: "Legend" });
    await expect.element(legend.getByText("store1: Acme X5 frame at l1", { exact: true })).toBeVisible();
    await expect.element(legend.getByText("store2: Acme X5 frame at l2", { exact: true })).toBeVisible();
    expect(curveSegments(chartOf(screen).element())).toHaveLength(TWO_DAYS);
  });

  it("leaves a gap over a day without a landed cost instead of bridging it", async () => {
    const screen = await open(scripted(charted([steady])));
    await expect.element(chartOf(screen)).toBeVisible();
    expect(curveSegments(chartOf(screen).element())).toEqual([TWO_DAYS]);
  });

  it("draws a landed cost with no priced neighbour as a dot", async () => {
    const screen = await open(scripted(charted([[LANDED_MINOR, null, LANDED_MINOR, null, null, null]])));
    await expect.element(chartOf(screen)).toBeVisible();
    expect(chartOf(screen).element().querySelectorAll(".history-dot")).toHaveLength(TWO_DAYS);
    const dot = chartOf(screen).element().querySelector(".history-dot");
    expect(dot?.getAttribute("stroke")).toBe("var(--color-surface)");
  });

  it("lets the keyboard reach the chart and step through the days to read every listing's cost", async () => {
    const screen = await open(scripted(charted([steady, other])));
    chartOf(screen).element().focus();
    await expect.element(chartOf(screen)).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByText(/^store2: Acme X5 frame at l2 \$120\.00$/u)).toBeVisible();
  });

  it("says a listing had no price on a day the keyboard steps to", async () => {
    const lateOnly = [null, null, null, null, null, LANDED_MINOR];
    const screen = await open(scripted(charted([lateOnly, other])));
    chartOf(screen).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByText(/^store1: Acme X5 frame at l1 No price$/u)).toBeVisible();
  });

  it("carries a price forward to the next scan, so scans less than daily still draw one line", async () => {
    const everyOtherDay = [LANDED_MINOR, LOWER_MINOR, LANDED_MINOR].map((amountMinor, index) =>
      snapshot("l1", (TWO_DAYS - index) * TWO_DAYS, { landedCost: usd(amountMinor) }));
    const screen = await open(scripted({
      product: product(ID, "Acme X5 frame"),
      listings: [{ listing: listing("l1"), history: everyOtherDay }],
    }));
    await expect.element(chartOf(screen)).toHaveAccessibleName(/^Landed cost over the last 5 days/u);
    expect(curveSegments(chartOf(screen).element())).toEqual([1]);
    expect(chartOf(screen).element().querySelectorAll(".history-dot")).toHaveLength(0);
  });

  it("counts each local calendar day once across a daylight saving change", async () => {
    const beforeChange = new Date(DST_YEAR, DST_MONTH, DST_DAY_BEFORE, NOON);
    const afterChange = new Date(DST_YEAR, DST_MONTH, DST_DAY_AFTER, NOON);
    const now = new Date();
    const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      - Date.UTC(DST_YEAR, DST_MONTH, DST_DAY_BEFORE)) / DAY_MS + 1;
    const screen = await open(scripted({
      product: product(ID, "Acme X5 frame"),
      listings: [{
        listing: listing("l1"),
        history: [
          snapshot("l1", 0, { observedAt: beforeChange, landedCost: usd(LANDED_BEFORE_MINOR) }),
          snapshot("l1", 0, { observedAt: afterChange, landedCost: usd(LANDED_MINOR) }),
        ],
      }],
    }));
    await expect.element(chartOf(screen)).toHaveAccessibleName(
      new RegExp(`^Landed cost over the last ${String(days)} days:`, "u"),
    );
    expect(curveSegments(chartOf(screen).element())).toEqual([1]);
  });

  it("ends a listing that is no longer active at its last snapshot instead of carrying it to today", async () => {
    const active = { listing: listing("l1"), history: daily("l1", [LOWER_MINOR, LOWER_MINOR, LOWER_MINOR]) };
    const gone = {
      listing: listing("l2", { status: ListingStatus.Gone }),
      history: [snapshot("l2", TWO_DAYS, { landedCost: usd(LANDED_MINOR) })],
    };
    const screen = await open(scripted({ product: product(ID, "Acme X5 frame"), listings: [active, gone] }));
    await expect.element(chartOf(screen)).toBeVisible();
    expect(curveSegments(chartOf(screen).element())).toEqual([1, 1]);
    expect(chartOf(screen).element().querySelectorAll(".history-dot")).toHaveLength(1);
  });

  it("buckets days in the viewer's time zone, so scans either side of local midnight are two days", async () => {
    const now = new Date();
    const lateYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, LATE_HOUR, LATE_MINUTE);
    const earlyToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, EARLY_MINUTE);
    const screen = await open(scripted({
      product: product(ID, "Acme X5 frame"),
      listings: [{
        listing: listing("l1"),
        history: [
          snapshot("l1", 0, { observedAt: lateYesterday, landedCost: usd(LANDED_BEFORE_MINOR) }),
          snapshot("l1", 0, { observedAt: earlyToday, landedCost: usd(LANDED_MINOR) }),
        ],
      }],
    }));
    await expect.element(chartOf(screen)).toHaveAccessibleName(
      "Landed cost over the last 2 days: shop: Acme X5 frame at l1 lowest $138.45, highest $150.00, latest $138.45",
    );
  });

  it("marks the hovered day with a dashed crosshair", async () => {
    const screen = await open(scripted(charted([steady])));
    await userEvent.hover(chartOf(screen));
    await expect.poll(() => chartOf(screen).element().querySelector(".recharts-tooltip-cursor")).not.toBeNull();
    const cursor = chartOf(screen).element().querySelector(".recharts-tooltip-cursor");
    expect(cursor?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("sets each listing's cost in the tooltip in the readout face", async () => {
    const screen = await open(scripted(charted([steady, other])));
    chartOf(screen).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const line = screen.getByText(/^store2: Acme X5 frame at l2 \$120\.00$/u);
    await expect.element(line).toBeVisible();
    const cost = line.element().lastElementChild;
    expect(cost?.textContent).toBe("$120.00");
    expect(cost === null ? "" : getComputedStyle(cost).fontFamily).toContain("Martian Mono");
  });

  it("says when no listing has a landed cost to chart", async () => {
    const screen = await open(scripted(charted([[null, null]])));
    await expect.element(screen.getByText("No landed cost to chart yet.")).toBeVisible();
  });

  it("charts the eight most recently priced listings and counts the ones it leaves out", async () => {
    const oldOnly = [LOWER_MINOR, null, null, null, null, null];
    const screen = await open(scripted(charted([oldOnly, ...Array.from({ length: SERIES_LIMIT }, () => other)])));
    await expect.element(screen.getByText("Not charted: 1 listing.", { exact: false })).toBeVisible();
    const legend = screen.getByRole("figure", { name: "Price history" }).getByRole("list", { name: "Legend" });
    await expect.element(legend.getByText("store1: Acme X5 frame at l1", { exact: true })).not.toBeInTheDocument();
    await expect.element(legend.getByText("store9: Acme X5 frame at l9", { exact: true })).toBeVisible();
    expect(curveSegments(chartOf(screen).element())).toHaveLength(SERIES_LIMIT);
  });

  it("gives no chart slot to a listing without a landed cost", async () => {
    const screen = await open(scripted(charted([steady, [null, null], [null]])));
    await expect.element(screen.getByText("Not charted: 2 listings.", { exact: false })).toBeVisible();
    const legend = screen.getByRole("figure", { name: "Price history" }).getByRole("list", { name: "Legend" });
    await expect.element(legend.getByRole("listitem")).toHaveTextContent("store1: Acme X5 frame at l1");
  });
});
