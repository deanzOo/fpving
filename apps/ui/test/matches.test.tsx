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
  alreadyTracked, at, emptyTrend, failWith, fakeApi, gate, heldBy, noContent, product, reply, wire, Role,
} from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";
import { rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

const FRAME = "p1";
const KIT = "p2";
const SIMILAR = 0.87;
const NONE = "none";

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

const rejectedLeaving = (api: ReturnType<typeof scripted>, candidateId: string) => {
  api.on(at(apiRoutes.rejectCandidate, { candidateId }), () => {
    api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, []));
    return noContent();
  });
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
    await expect.element(frame.getByText(/Same product: same model and size/u)).toBeVisible();
    await expect.element(frame.getByText("87% similar, on mall")).toBeVisible();
    await expect.element(group(screen, "Acme X5 kit").getByText("Not judged yet")).toBeVisible();
  });

  it.each([
    [LlmVerdict.Same, "Same product", "✓", "--color-good"],
    [LlmVerdict.Variant, "A variant", "≈", "--color-info"],
    [LlmVerdict.Different, "Different product", "≠", "--color-ink-muted"],
    [LlmVerdict.Unjudged, "Not judged yet", "?", "--color-ink-muted"],
  ])("shows a %s verdict as a badge: its words, its glyph and its colour", async (llmVerdict, words, glyph, ink) => {
    const llmReason = llmVerdict === LlmVerdict.Unjudged ? null : "same model and size";
    const screen = await renderApp(scripted([candidate("c1", FRAME, { llmVerdict, llmReason })]).client, "/matches");
    await screen.getByRole("checkbox", { name: "Show candidates judged different" }).click();
    const verdict = group(screen, "Acme X5 frame").getByText(words, { exact: true });
    await expect.element(verdict).toBeVisible();
    expect(verdict.element().previousElementSibling?.textContent).toBe(glyph);
    expect(styleOf(verdict).color).toBe(rgb(token(ink)));
  });

  it("dashes the not judged badge, and only that one", async () => {
    const screen = await renderApp(scripted([
      candidate("c1", FRAME),
      candidate("c2", FRAME, { llmVerdict: LlmVerdict.Unjudged, llmReason: null }),
    ]).client, "/matches");
    const border = (words: string) => {
      const badge = group(screen, "Acme X5 frame").getByText(words, { exact: true }).element().parentElement;
      return badge === null ? "" : getComputedStyle(badge).borderTopStyle;
    };
    await expect.element(group(screen, "Acme X5 frame").getByText("Not judged yet", { exact: true })).toBeVisible();
    expect(border("Not judged yet")).toBe("dashed");
    expect(border("Same product")).toBe("solid");
  });

  it("frames the first candidate waiting for review, and only that one", async () => {
    const screen = await renderApp(
      scripted([candidate("c1", FRAME), candidate("c2", FRAME)], [candidate("c3", KIT)]).client, "/matches",
    );
    const framed = (name: string) => {
      const item = screen.getByRole("listitem").filter({ hasText: name });
      const parts = [...item.element().querySelectorAll("*")];
      return parts.some((part) => getComputedStyle(part, "::after").content !== NONE);
    };
    await expect.element(screen.getByRole("link", { name: "Acme X5 c3" })).toBeVisible();
    expect([framed("Acme X5 c1"), framed("Acme X5 c2"), framed("Acme X5 c3")]).toEqual([true, false, false]);
  });

  it("says Accepting… on the accepted candidate while it is on its way, holding its reject button", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    const accepting = gate();
    const added = reply(wire.addedListing, accepted, HttpStatus.Created);
    api.on(at(apiRoutes.acceptCandidate, { candidateId: "c1" }), heldBy(accepting, added));
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: "Accept Acme X5 c1" }).click();
    await expect.element(screen.getByRole("button", { name: "Accept Acme X5 c1" })).toHaveTextContent("Accepting…");
    const reject = screen.getByRole("button", { name: "Reject Acme X5 c1" });
    await expect.element(reject).toHaveTextContent("Reject");
    await expect.element(reject).toHaveAttribute("aria-disabled", "true");
    accepting.release();
  });

  it("says Rejecting… on the rejected candidate while it is on its way", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    const rejecting = gate();
    api.on(at(apiRoutes.rejectCandidate, { candidateId: "c1" }), heldBy(rejecting, noContent));
    const screen = await renderApp(api.client, "/matches");
    await screen.getByRole("button", { name: "Reject Acme X5 c1" }).click();
    await expect.element(screen.getByRole("button", { name: "Reject Acme X5 c1" })).toHaveTextContent("Rejecting…");
    rejecting.release();
  });

  it("sets the similarity in the readout face", async () => {
    const screen = await renderApp(scripted([candidate("c1", FRAME)]).client, "/matches");
    const similar = group(screen, "Acme X5 frame").getByText("87%", { exact: true });
    await expect.element(similar).toBeVisible();
    expect(styleOf(similar).fontFamily).toContain("Martian Mono");
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
    await expect.element(frame.getByText(/Different product: another frame size/u)).toBeVisible();
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
      .toHaveTextContent("Done Added Acme X5 c1 to Acme X5 frame.");
    await expect.element(screen.getByRole("link", { name: "Acme X5 c1" })).not.toBeInTheDocument();
  });

  it("moves focus to the next candidate after a review, or to the product heading when none is left", async () => {
    const api = scripted([candidate("c1", FRAME), candidate("c2", FRAME)]);
    api.on(at(apiRoutes.acceptCandidate, { candidateId: "c1" }), () => {
      api.on(at(apiRoutes.listCandidates, { productId: FRAME }), reply(wire.candidates, [candidate("c2", FRAME)]));
      return reply(wire.addedListing, accepted, HttpStatus.Created)();
    });
    rejectedLeaving(api, "c2");
    const screen = await renderApp(api.client, "/matches");
    const frame = group(screen, "Acme X5 frame");
    await frame.getByRole("button", { name: "Accept Acme X5 c1" }).click();
    await expect.element(frame.getByRole("listitem")).toHaveFocus();
    await frame.getByRole("button", { name: "Reject Acme X5 c2" }).click();
    await expect.element(frame.getByRole("heading", { level: 2, name: "Acme X5 frame" })).toHaveFocus();
    await expect.element(frame.getByRole("status")).toHaveTextContent("Done Rejected Acme X5 c2.");
  });

  it("rejects a candidate and drops it from the queue", async () => {
    const api = scripted([candidate("c1", FRAME)]);
    rejectedLeaving(api, "c1");
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
    await expect.element(frame.getByRole("button", { name: "Searching the other stores…" }))
      .toHaveAttribute("aria-disabled", "true");
    searched.release();
    await expect.element(frame.getByRole("link", { name: "Acme X5 c1" })).toBeVisible();
    await expect.element(frame.getByRole("status"))
      .toHaveTextContent("Done Saved 1 candidates. The search failed on bazaar (blocked).");
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
  ] satisfies [string, number, PlainErrorKind, string][])("explains a refused %s: %s %s, focus kept", async (
    action, status, kind, said,
  ) => {
    const api = scripted([candidate("c1", FRAME)]);
    const route = action === "accept" ? apiRoutes.acceptCandidate : apiRoutes.rejectCandidate;
    api.on(at(route, { candidateId: "c1" }), failWith(status, kind, "refused"));
    const screen = await renderApp(api.client, "/matches");
    const button = screen.getByRole("button", { name: `${action === "accept" ? "Accept" : "Reject"} Acme X5 c1` });
    await button.click();
    await expect.element(group(screen, "Acme X5 frame").getByRole("alert")).toHaveTextContent(`Refused ${said}`);
    await expect.element(button).toHaveFocus();
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
    [HttpStatus.Conflict, ApiErrorKind.AlreadySuggested, Role.Alert,
      "Refused Another search saved candidates for this product meanwhile. Search again."],
    [HttpStatus.Conflict, ApiErrorKind.NoSourceListing, Role.Alert,
      "Refused This product has no listing added by URL to search from. Add one first."],
    [HttpStatus.NotFound, ApiErrorKind.ProductNotFound, Role.Alert, "Refused This product is not watched any more."],
    [HttpStatus.ServiceUnavailable, ApiErrorKind.Restarting, Role.Status,
      "Restarting fpving is restarting its plugins for a settings change. Try again in a moment."],
  ] satisfies [number, PlainErrorKind, Role, string][])("explains a refused search: %d %s", async (
    status, kind, role, said,
  ) => {
    const api = scripted([]);
    api.on(at(apiRoutes.findMatches, { productId: FRAME }), failWith(status, kind, "refused"));
    const screen = await renderApp(api.client, "/matches");
    const find = group(screen, "Acme X5 frame").getByRole("button", { name: "Find matches" });
    await find.click();
    const told = group(screen, "Acme X5 frame").getByRole(role).filter({ hasText: said });
    await expect.element(told).toHaveTextContent(said);
    await expect.element(find).toHaveFocus();
  });
});
