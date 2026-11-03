import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { listingIdSchema, snapshotIdSchema, TREND_DAYS } from "@fpving/core";
import type { Money } from "@fpving/plugin-sdk";
import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { z } from "zod";
import {
  alreadyTracked, at, emptyTrend, failWith, fakeApi, gate, heldBy, product, reply, Role, wire,
} from "./support/fake-api.ts";
import { curveSegments } from "./support/chart.ts";
import { renderApp } from "./support/render-app.tsx";
import { rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

type Row = z.output<typeof wire.watchlist>[number];

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

const PAGE = "https://shop.example/item/frame";

const PRICED_DAYS = 27;
const PRICE_MINOR = 12_345;
const LOWER_MINOR = 11_000;
const PRICE = usd(PRICE_MINOR);
const LOWER = usd(LOWER_MINOR);
const LEFT_EDGE = { x: 4, y: 16 };
const HALF = 2;
const SEGMENTS_AROUND_ONE_GAP = 2;
const GAP_DAY = 10;
const LONE_PRICES = 2;

const row = (overrides: Partial<Row> = {}): Row => ({
  product: product("p1", "Acme X5 frame"),
  cheapest: { listingId: listingIdSchema.parse("p1-l1"), landedCost: PRICE },
  trend: emptyTrend().map((_none, day) => (day >= TREND_DAYS - PRICED_DAYS ? PRICE : null)),
  unreadAlerts: 0,
  ...overrides,
});

const added = (name: string) => wire.added.parse({
  product: product("p2", name),
  listing: {
    id: listingIdSchema.parse("p2-l1"), productId: "p2", pluginId: "shop", url: PAGE, title: name,
    status: "active", origin: "manual", addedAt: new Date(0), failureStreak: 0, notFoundStreak: 0,
  },
  snapshot: {
    id: snapshotIdSchema.parse("s1"), listingId: "p2-l1", observedAt: new Date(0), shipTo: "IL", itemPrice: PRICE,
    shipping: { kind: ShippingKind.Unknown }, inStock: true,
  },
});

const scripted = (rows: Row[]) => {
  const api = fakeApi();
  api.on(at(apiRoutes.getProduct, { productId: "p1" }), reply(wire.detail, { product: row().product, listings: [] }));
  api.on(apiRoutes.listProducts, reply(wire.watchlist, rows));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  return api;
};

describe("Watchlist", () => {
  it("lists each product with its cheapest landed cost, its unread count and a link to its page", async () => {
    const screen = await renderApp(scripted([row({ unreadAlerts: 3 })]).client);
    const line = screen.getByRole("row", { name: /Acme X5 frame/u });
    await expect.element(line.getByRole("cell", { name: "$123.45" })).toBeVisible();
    await expect.element(line.getByText("3 unread")).toBeVisible();
    await line.getByRole("link", { name: "Acme X5 frame" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Acme X5 frame" })).toBeVisible();
  });

  it("marks a row's unread alerts as a live status in the signal colour", async () => {
    const screen = await renderApp(scripted([row({ unreadAlerts: 3 })]).client);
    const unread = screen.getByRole("row", { name: /Acme X5 frame/u }).getByText("3 unread");
    await expect.element(unread).toBeVisible();
    const badge = unread.element().parentElement;
    expect(badge === null ? "" : getComputedStyle(badge).color).toBe(rgb(token("--color-signal")));
  });

  it("sets the cheapest landed cost in the readout face", async () => {
    const screen = await renderApp(scripted([row()]).client);
    const price = screen.getByRole("row", { name: /Acme X5 frame/u }).getByText("$123.45");
    await expect.element(price).toBeVisible();
    expect(styleOf(price).fontFamily).toContain("Martian Mono");
  });

  it("says when a product has no price yet and shows no unread count when none is unread", async () => {
    const screen = await renderApp(scripted([row({ cheapest: null, trend: emptyTrend() })]).client);
    const line = screen.getByRole("row", { name: /Acme X5 frame/u });
    await expect.element(line.getByText("No price yet")).toBeVisible();
    await expect.element(line.getByText("No prices in the last 30 days")).toBeVisible();
    await expect.element(line.getByText("unread", { exact: false })).not.toBeInTheDocument();
  });

  it("draws the 30-day trend as a line that breaks over days without a price instead of bridging them", async () => {
    const gapDay = Math.floor(TREND_DAYS / HALF);
    const trend = row().trend.map((price, day) => (day === gapDay ? null : price));
    const screen = await renderApp(scripted([row({ trend })]).client);
    await expect.element(screen.getByRole("application", { name: /lowest \$123\.45/u })).toBeVisible();
    expect(curveSegments(screen.container)).toEqual([SEGMENTS_AROUND_ONE_GAP]);
  });

  it("draws a price with no priced neighbour as a dot, so a product added today shows on its trend", async () => {
    const today = emptyTrend().map((_none, day) => (day === TREND_DAYS - 1 ? PRICE : null));
    const lone = emptyTrend().map((_none, day) => (day === GAP_DAY || day === TREND_DAYS - 1 ? PRICE : null));
    const screen = await renderApp(scripted([
      row({ trend: today }),
      row({ product: product("p2", "Acme X5 kit"), trend: lone }),
      row({ product: product("p3", "Acme X5 arms") }),
    ]).client);
    const dots = (name: RegExp) =>
      screen.getByRole("row", { name }).element().querySelectorAll(".sparkline-dot").length;
    await expect.element(screen.getByRole("row", { name: /Acme X5 arms/u })).toBeVisible();
    expect(dots(/Acme X5 frame/u)).toBe(1);
    expect(dots(/Acme X5 kit/u)).toBe(LONE_PRICES);
    expect(dots(/Acme X5 arms/u)).toBe(0);
  });

  it("names the trend's range and latest price for screen readers", async () => {
    const trend = row().trend.map((price, day) => (day === TREND_DAYS - 1 ? LOWER : price));
    const screen = await renderApp(scripted([row({ trend })]).client);
    const name = "Last 30 days: lowest $110.00, highest $123.45, latest $110.00, 27 days with a price";
    await expect.element(screen.getByRole("application", { name })).toBeVisible();
  });

  it("shows the price of the day under the pointer", async () => {
    const screen = await renderApp(scripted([row()]).client);
    await userEvent.hover(screen.getByRole("application", { name: /Last 30 days/u }));
    await expect.element(screen.getByText(/\$123\.45, (today|yesterday|\d+ days ago)/u)).toBeVisible();
  });

  it("lets the keyboard reach the trend and step through the days to read each price", async () => {
    const screen = await renderApp(scripted([row()]).client);
    await screen.getByLabelText("Store URL").click();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    const chart = screen.getByRole("application", { name: /^Last 30 days: lowest \$123\.45/u });
    await expect.element(chart).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByText(/^(No price|\$123\.45), (today|yesterday|\d+ days ago)$/u)).toBeVisible();
  });

  it("says a day had no price when the pointer is over a gap", async () => {
    const screen = await renderApp(scripted([row()]).client);
    await userEvent.hover(screen.getByRole("application", { name: /Last 30 days/u }), { position: LEFT_EDGE });
    await expect.element(screen.getByText("No price, 29 days ago")).toBeVisible();
  });

  it("invites pasting a URL when nothing is watched yet", async () => {
    const screen = await renderApp(scripted([]).client);
    await expect.element(screen.getByText("Nothing is watched yet", { exact: false })).toBeVisible();
    await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
  });
});

describe("Adding a product by URL", () => {
  it("adds the pasted URL, says what it now watches and refreshes the list", async () => {
    const api = scripted([]);
    api.on(apiRoutes.addProduct, () => {
      api.on(apiRoutes.listProducts, reply(wire.watchlist, [row({ product: product("p2", "Acme X5 kit") })]));
      return reply(wire.added, added("Acme X5 kit"), HttpStatus.Created)();
    });
    const screen = await renderApp(api.client);
    const field = screen.getByLabelText("Store URL");
    await field.fill(PAGE);
    await screen.getByRole("button", { name: "Add product" }).click();
    await expect.element(screen.getByRole("status").filter({ hasText: "Now watching" }))
      .toHaveTextContent("Done Now watching Acme X5 kit");
    expect(styleOf(screen.getByText("Done", { exact: true })).color).toBe(rgb(token("--color-ink-muted")));
    await expect.element(screen.getByRole("link", { name: "Acme X5 kit" })).toBeVisible();
    await expect.element(field).toHaveValue("");
    expect(api.sent).toContainEqual({ method: "POST", path: apiRoutes.addProduct.url, body: { url: PAGE } });
  });

  it("keeps its status region in place before an add, so the result is announced as it changes", async () => {
    const api = scripted([]);
    api.on(apiRoutes.addProduct, reply(wire.added, added("Acme X5 kit"), HttpStatus.Created));
    const screen = await renderApp(api.client);
    const field = screen.getByLabelText("Store URL");
    await expect.element(field).toBeVisible();
    const region = field.element().closest("form")?.querySelector("[role=status]");
    expect(region).toBeInstanceOf(HTMLElement);
    await field.fill(PAGE);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => region?.textContent).toBe("Done Now watching Acme X5 kit");
  });

  it("marks the button unavailable while fetching, keeps focus on it and ignores another press", async () => {
    const api = scripted([]);
    const fetched = gate();
    api.on(apiRoutes.addProduct, async () => {
      await fetched.opened;
      return reply(wire.added, added("Acme X5 kit"), HttpStatus.Created)();
    });
    const screen = await renderApp(api.client);
    await screen.getByLabelText("Store URL").fill(PAGE);
    await screen.getByRole("button", { name: "Add product" }).click();
    const adding = screen.getByRole("button", { name: "Adding…" });
    await expect.element(adding).toHaveAttribute("aria-disabled", "true");
    await expect.element(adding).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    fetched.release();
    await expect.element(screen.getByRole("button", { name: "Add product" })).toHaveAttribute("aria-disabled", "false");
    expect(api.sent.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("ignores Enter from the field while the add is on its way", async () => {
    const api = scripted([]);
    const fetched = gate();
    api.on(apiRoutes.addProduct, heldBy(fetched, reply(wire.added, added("Acme X5 kit"), HttpStatus.Created)));
    const screen = await renderApp(api.client);
    const field = screen.getByLabelText("Store URL");
    await field.fill(PAGE);
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("button", { name: "Adding…" })).toHaveAttribute("aria-disabled", "true");
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    fetched.release();
    await expect.element(screen.getByRole("status").filter({ hasText: "Now watching" })).toBeVisible();
    const adds = api.sent.filter(({ method, path }) => method === "POST" && path === apiRoutes.addProduct.url);
    expect(adds).toHaveLength(1);
  });

  it.each([
    [ApiErrorKind.NoPluginForDomain, HttpStatus.UnprocessableContent, "no plugin handles shop-mirror.example",
      Role.Alert, "Refused",
      "No installed plugin handles this store (no plugin handles shop-mirror.example). List one in plugins.json, "
      + "then check Plugins."],
    [ApiErrorKind.PluginUnavailable, HttpStatus.UnprocessableContent, "the plugin is not loaded",
      Role.Alert, "Refused", "The plugin for this store is installed but not loaded. Check Plugins."],
    [ApiErrorKind.Restarting, HttpStatus.ServiceUnavailable, "restarting",
      Role.Status, "Restarting", "fpving is restarting its plugins for a settings change. Try again in a moment."],
    [ApiErrorKind.FetchFailed, HttpStatus.BadGateway, "the store could not fetch the page: network",
      Role.Alert, "Failed", "the store could not fetch the page: network"],
  ])("explains a %s refusal next to the URL field", async (kind, status, message, role, tag, shown) => {
    const api = scripted([]);
    api.on(apiRoutes.addProduct, failWith(status, kind, message));
    const screen = await renderApp(api.client);
    const field = screen.getByLabelText("Store URL");
    await field.fill(PAGE);
    await userEvent.keyboard("{Enter}");
    const tagged = `${tag} ${shown}`;
    await expect.element(screen.getByRole(role).filter({ hasText: tagged })).toHaveTextContent(tagged);
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
    await expect.element(field).toHaveAccessibleDescription(shown);
  });

  it("links an already_tracked refusal to the product that already watches the page", async () => {
    const api = scripted([]);
    api.on(apiRoutes.addProduct, alreadyTracked("p1", "Acme X5 frame"));
    const screen = await renderApp(api.client);
    await screen.getByLabelText("Store URL").fill(PAGE);
    await userEvent.keyboard("{Enter}");
    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Refused Already watched as Acme X5 frame");
    await expect.element(alert.getByRole("link", { name: "Acme X5 frame" })).toHaveAttribute("href", "/products/p1");
  });
});
