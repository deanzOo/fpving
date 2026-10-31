import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { listingIdSchema, snapshotIdSchema, TREND_DAYS } from "@fpving/core";
import type { Money } from "@fpving/plugin-sdk";
import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { z } from "zod";
import { emptyTrend, failWith, fakeApi, product, reply, wire } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

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
  api.on(apiRoutes.listProducts, reply(wire.watchlist, rows));
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  return api;
};

const lineSegments = (container: HTMLElement): number =>
  (container.querySelector(".recharts-line-curve")?.getAttribute("d") ?? "").split("M").length - 1;

describe("Watchlist", () => {
  it("lists each product with its cheapest landed cost, its unread count and a link to its page", async () => {
    const screen = await renderApp(scripted([row({ unreadAlerts: 3 })]).client);
    const line = screen.getByRole("row", { name: /Acme X5 frame/u });
    await expect.element(line.getByRole("cell", { name: "$123.45" })).toBeVisible();
    await expect.element(line.getByText("3 unread")).toBeVisible();
    await line.getByRole("link", { name: "Acme X5 frame" }).click();
    await expect.element(screen.getByRole("heading", { level: 1, name: "Product" })).toBeVisible();
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
    await expect.element(screen.getByRole("img", { name: /lowest \$123\.45/u })).toBeVisible();
    expect(lineSegments(screen.container)).toBe(SEGMENTS_AROUND_ONE_GAP);
  });

  it("names the trend's range and latest price for screen readers", async () => {
    const trend = row().trend.map((price, day) => (day === TREND_DAYS - 1 ? LOWER : price));
    const screen = await renderApp(scripted([row({ trend })]).client);
    const name = "Last 30 days: lowest $110.00, highest $123.45, latest $110.00, 27 days with a price";
    await expect.element(screen.getByRole("img", { name })).toBeVisible();
  });

  it("shows the price of the day under the pointer", async () => {
    const screen = await renderApp(scripted([row()]).client);
    await userEvent.hover(screen.getByRole("img", { name: /Last 30 days/u }));
    await expect.element(screen.getByText(/\$123\.45, (today|yesterday|\d+ days ago)/u)).toBeVisible();
  });

  it("says a day had no price when the pointer is over a gap", async () => {
    const screen = await renderApp(scripted([row()]).client);
    await userEvent.hover(screen.getByRole("img", { name: /Last 30 days/u }), { position: LEFT_EDGE });
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
    await expect.element(screen.getByRole("status")).toHaveTextContent("Now watching Acme X5 kit");
    await expect.element(screen.getByRole("link", { name: "Acme X5 kit" })).toBeVisible();
    await expect.element(field).toHaveValue("");
    expect(api.sent).toContainEqual({ method: "POST", path: apiRoutes.addProduct.url, body: { url: PAGE } });
  });

  it("disables the button while the store page is being fetched", async () => {
    const api = scripted([]);
    let release = (): void => undefined;
    const fetched = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on(apiRoutes.addProduct, async () => {
      await fetched;
      return reply(wire.added, added("Acme X5 kit"), HttpStatus.Created)();
    });
    const screen = await renderApp(api.client);
    await screen.getByLabelText("Store URL").fill(PAGE);
    await screen.getByRole("button", { name: "Add product" }).click();
    await expect.element(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    release();
    await expect.element(screen.getByRole("button", { name: "Add product" })).toBeEnabled();
  });

  it.each([
    [ApiErrorKind.NoPluginForDomain, HttpStatus.UnprocessableContent, "no plugin handles shop.example",
      "No installed plugin handles shop.example. List one in plugins.json, then check Plugins."],
    [ApiErrorKind.PluginUnavailable, HttpStatus.UnprocessableContent, "the plugin is not loaded",
      "The plugin for this store is installed but not loaded. Check Plugins."],
    [ApiErrorKind.AlreadyTracked, HttpStatus.Conflict, "already tracked by product p1 \"Acme X5 frame\"",
      "This page is already watched: already tracked by product p1 \"Acme X5 frame\"."],
    [ApiErrorKind.Restarting, HttpStatus.ServiceUnavailable, "restarting",
      "fpving is restarting its plugins for a settings change. Try again in a moment."],
    [ApiErrorKind.FetchFailed, HttpStatus.BadGateway, "the store could not fetch the page: network",
      "the store could not fetch the page: network"],
  ])("explains a %s refusal next to the URL field", async (kind, status, message, shown) => {
    const api = scripted([]);
    api.on(apiRoutes.addProduct, failWith(status, kind, message));
    const screen = await renderApp(api.client);
    const field = screen.getByLabelText("Store URL");
    await field.fill(PAGE);
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("alert")).toHaveTextContent(shown);
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
    await expect.element(field).toHaveAccessibleDescription(shown);
  });
});
