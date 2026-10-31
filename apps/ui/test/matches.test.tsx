import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import type { PlainErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import {
  CandidateStatus,
  listingIdSchema,
  LlmVerdict,
  matchCandidateIdSchema,
  pluginIdSchema,
  productIdSchema,
  snapshotIdSchema,
} from "@fpving/core";
import type { MatchCandidate } from "@fpving/core";
import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  alreadyTracked, at, emptyTrend, failWith, fakeApi, gate, noContent, product, reply, wire,
} from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";

const FRAME = "p1";
const KIT = "p2";
const SIMILAR = 0.87;

const candidate = (id: string, productId: string, overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: matchCandidateIdSchema.parse(id),
  productId: productIdSchema.parse(productId),
  pluginId: pluginIdSchema.parse("mall"),
  url: `https://mall.example/${id}`,
  title: `Acme X5 ${id}`,
  similarityScore: SIMILAR,
  llmVerdict: LlmVerdict.Same,
  llmReason: "same model and size",
  status: CandidateStatus.Pending,
  ...overrides,
});

const accepted = wire.addedListing.parse({
  listing: {
    id: listingIdSchema.parse("l9"), productId: FRAME, pluginId: "mall", url: "https://mall.example/c1",
    title: "Acme X5 c1", status: "active", origin: "matched", addedAt: new Date(0), failureStreak: 0,
    notFoundStreak: 0,
  },
  snapshot: {
    id: snapshotIdSchema.parse("s9"), listingId: "l9", observedAt: new Date(0), shipTo: "IL",
    itemPrice: { amountMinor: 100, currency: "USD" }, shipping: { kind: ShippingKind.Unknown }, inStock: true,
  },
});

const row = (id: string, name: string) => ({
  product: product(id, name), cheapest: null, trend: emptyTrend(), unreadAlerts: 0,
});

const scripted = (frame: MatchCandidate[], kit: MatchCandidate[] = []) => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.listProducts, reply(wire.watchlist, [row(FRAME, "Acme X5 frame"), row(KIT, "Acme X5 kit")]));
  api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, frame));
  api.on(at(apiRoutes.listCandidates, { productId: KIT }), reply(wire.candidates, kit));
  return api;
};

const group = (screen: Awaited<ReturnType<typeof renderApp>>, name: string) =>
  screen.getByRole("region", { name });

describe("Match review", () => {
  it("groups the pending candidates by product with verdict, reason, similarity and a link to the page", async () => {
    const unjudged = candidate("c2", KIT, { llmVerdict: LlmVerdict.Unjudged, llmReason: null });
    const screen = await renderApp(scripted([candidate("c1", FRAME)], [unjudged]).client, "/matches");
    const frame = group(screen, "Acme X5 frame");
    await expect.element(frame.getByRole("link", { name: "Acme X5 c1" }))
      .toHaveAttribute("href", "https://mall.example/c1");
    await expect.element(frame.getByText("Same product: same model and size")).toBeVisible();
    await expect.element(frame.getByText("87% similar, on mall")).toBeVisible();
    await expect.element(group(screen, "Acme X5 kit").getByText("Not judged yet")).toBeVisible();
  });

  it("hides candidates judged different until asked to show them", async () => {
    const different = candidate("c2", FRAME, { llmVerdict: LlmVerdict.Different, llmReason: "another frame size" });
    const screen = await renderApp(scripted([candidate("c1", FRAME), different]).client, "/matches");
    const frame = group(screen, "Acme X5 frame");
    await expect.element(frame.getByRole("link", { name: "Acme X5 c1" })).toBeVisible();
    await expect.element(frame.getByRole("link", { name: "Acme X5 c2" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: "Show candidates judged different" });
    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    await expect.element(frame.getByText("Different product: another frame size")).toBeVisible();
    await toggle.click();
    await expect.element(frame.getByRole("link", { name: "Acme X5 c2" })).not.toBeInTheDocument();
  });

  it("says nothing waits for review when every pending candidate was judged different", async () => {
    const different = candidate("c2", FRAME, { llmVerdict: LlmVerdict.Different, llmReason: "another frame size" });
    const screen = await renderApp(scripted([different]).client, "/matches");
    await expect.element(screen.getByText("No match candidates are waiting for review.")).toBeVisible();
  });

  it("accepts a candidate as a listing of its product and drops it from the queue", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    api.on(at(apiRoutes.acceptCandidate, { candidateId: "c1" }), () => {
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, []));
      return reply(wire.addedListing, accepted, HttpStatus.Created)();
    });
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: "Accept Acme X5 c1" }).click();
    await expect.element(screen.getByRole("status").filter({ hasText: "Added" }))
      .toHaveTextContent("Added Acme X5 c1 to Acme X5 frame.");
    await expect.element(screen.getByRole("link", { name: "Acme X5 c1" })).not.toBeInTheDocument();
  });

  it("moves focus to the next candidate after a review, or to the product heading when none is left", async () => {
    const api = scripted([candidate("c1", FRAME), candidate("c2", FRAME)]);
    api.on(at(apiRoutes.acceptCandidate, { candidateId: "c1" }), () => {
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, [candidate("c2", FRAME)]));
      return reply(wire.addedListing, accepted, HttpStatus.Created)();
    });
    api.on(at(apiRoutes.rejectCandidate, { candidateId: "c2" }), () => {
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, []));
      return noContent();
    });
    const screen = await renderApp(api.client, "/matches");
    const frame = group(screen, "Acme X5 frame");
    await frame.getByRole("button", { name: "Accept Acme X5 c1" }).click();
    await expect.element(frame.getByRole("listitem")).toHaveFocus();
    await frame.getByRole("button", { name: "Reject Acme X5 c2" }).click();
    await expect.element(frame.getByRole("heading", { level: 2, name: "Acme X5 frame" })).toHaveFocus();
    await expect.element(frame.getByRole("status")).toHaveTextContent("Rejected Acme X5 c2.");
  });

  it("rejects a candidate and drops it from the queue", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    api.on(at(apiRoutes.rejectCandidate, { candidateId: "c1" }), () => {
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, []));
      return noContent();
    });
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: "Reject Acme X5 c1" }).click();
    await expect.element(screen.getByRole("link", { name: "Acme X5 c1" })).not.toBeInTheDocument();
  });

  it("finds matches for a product, showing the search while it runs and what it found", async () => {
    const api = scripted([]);
    const searched = gate();
    api.on(at(apiRoutes.findMatches, { productId: FRAME }), async () => {
      await searched.opened;
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, [candidate("c1", FRAME)]));
      return reply(wire.found, {
        candidates: [candidate("c1", FRAME)],
        failedSearches: [
          { pluginId: pluginIdSchema.parse("bazaar"), error: { kind: StoreErrorKind.Blocked, detail: "captcha" } },
        ],
        foreignResults: [],
      })();
    });
    const screen = await renderApp(api.client, "/matches");
    const frame = group(screen, "Acme X5 frame");
    await frame.getByRole("button", { name: "Find matches" }).click();
    await expect.element(frame.getByRole("button", { name: "Searching the other stores…" })).toBeDisabled();
    searched.release();
    await expect.element(frame.getByRole("link", { name: "Acme X5 c1" })).toBeVisible();
    await expect.element(frame.getByRole("status"))
      .toHaveTextContent("Saved 1 candidates. The search failed on bazaar (blocked).");
  });

  it("says when no candidate is waiting for review", async () => {
    const screen = await renderApp(scripted([]).client, "/matches");
    await expect.element(screen.getByText("No match candidates are waiting for review.")).toBeVisible();
    await expect.element(group(screen, "Acme X5 kit").getByText("No pending candidates.")).toBeVisible();
  });

  it("says when nothing is watched", async () => {
    const api = scripted([]);
    api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
    const screen = await renderApp(api.client, "/matches");
    await expect.element(screen.getByText("Nothing is watched yet", { exact: false })).toBeVisible();
  });

  it.each([
    ["accept", HttpStatus.NotFound, ApiErrorKind.NotPending, "This candidate was already reviewed."],
    ["accept", HttpStatus.UnprocessableContent, ApiErrorKind.PluginUnavailable,
      "The plugin for this store is installed but not loaded. Check Plugins."],
    ["accept", HttpStatus.NotFound, ApiErrorKind.ProductNotFound, "This product is not watched any more."],
    ["reject", HttpStatus.NotFound, ApiErrorKind.NotPending, "This candidate was already reviewed."],
  ] satisfies [string, number, PlainErrorKind, string][])("explains a refused %s: %s %s", async (
    action, status, kind, said,
  ) => {
    const api = scripted([candidate("c1", FRAME)]);
    const route = action === "accept" ? apiRoutes.acceptCandidate : apiRoutes.rejectCandidate;
    api.on(at(route, { candidateId: "c1" }), failWith(status, kind, "refused"));
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: `${action === "accept" ? "Accept" : "Reject"} Acme X5 c1` }).click();
    await expect.element(group(screen, "Acme X5 frame").getByRole("alert")).toHaveTextContent(said);
  });

  it("links an accepted candidate that another product already watches to that product", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    api.on(at(apiRoutes.acceptCandidate, { candidateId: "c1" }), alreadyTracked(KIT, "Acme X5 kit"));
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: "Accept Acme X5 c1" }).click();
    const alert = group(screen, "Acme X5 frame").getByRole("alert");
    await expect.element(alert.getByRole("link", { name: "Acme X5 kit" })).toHaveAttribute("href", "/products/p2");
  });

  it.each([
    [HttpStatus.Conflict, ApiErrorKind.AlreadySuggested,
      "Another search saved candidates for this product meanwhile. Search again."],
    [HttpStatus.Conflict, ApiErrorKind.NoSourceListing,
      "This product has no listing added by URL to search from. Add one first."],
    [HttpStatus.NotFound, ApiErrorKind.ProductNotFound, "This product is not watched any more."],
    [HttpStatus.ServiceUnavailable, ApiErrorKind.Restarting,
      "fpving is restarting its plugins for a settings change. Try again in a moment."],
  ] satisfies [number, PlainErrorKind, string][])("explains a refused search: %d %s", async (status, kind, said) => {
    const api = scripted([]);
    api.on(at(apiRoutes.findMatches, { productId: FRAME }), failWith(status, kind, "refused"));
    const screen = await renderApp(api.client, "/matches");
    await group(screen, "Acme X5 frame").getByRole("button", { name: "Find matches" }).click();
    await expect.element(group(screen, "Acme X5 frame").getByRole("alert")).toHaveTextContent(said);
  });
});
