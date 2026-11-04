import { listingIdSchema, ListingOrigin, ListingStatus, pluginIdSchema, productIdSchema } from "@fpving/core";
import type { Listing } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { PluginIssueKind, PluginStatusKind } from "../../src/plugins/status.ts";
import { NOT_LISTED, pluginRows } from "../../src/server/plugin-rows.ts";
import type { PluginActivity } from "../../src/server/plugin-rows.ts";
import { MANIFEST } from "../plugins/runtime/fake-worker.ts";

const warning = { kind: PluginIssueKind.DomainConflict, detail: "shop.example is claimed twice" };
const NOW = new Date("2026-10-31T00:00:00Z");
const LATER = new Date("2026-10-31T01:00:00Z");
const quiet: PluginActivity = { health: [], scanned: [], now: NOW };
const SHOP = pluginIdSchema.parse(MANIFEST.id);
const OTHER = pluginIdSchema.parse("other-shop");
const OWN_STALE = 2;
const TWO_OWN = 2;

const scanned = (id: string, pluginId: typeof SHOP, status: Listing["status"]): Listing => ({
  id: listingIdSchema.parse(id),
  productId: productIdSchema.parse("p1"),
  pluginId,
  url: `https://shop.example.com/${id}`,
  title: id,
  status,
  origin: ListingOrigin.Manual,
  addedAt: NOW,
  failureStreak: 0,
  notFoundStreak: 0,
});

const loaded = { kind: PluginStatusKind.Loaded, warnings: [] };

describe("Plugins screen rows", () => {
  it("names a package entry by its package and lists a loaded plugin's warnings", () => {
    const state = {
      entry: { package: "@acme/fpving-shop" },
      manifest: null,
      status: { kind: PluginStatusKind.Loaded, warnings: [warning] },
    };
    expect(pluginRows([state], [], null, quiet)).toEqual([
      {
        source: "@acme/fpving-shop",
        manifest: null,
        status: PluginStatusKind.Loaded,
        issues: [warning],
        backoffUntil: null,
        staleListings: 0,
        unscannedListings: 0,
      },
    ]);
  });

  it("lists a disabled plugin with its reason", () => {
    const reason = { kind: PluginIssueKind.Crashed, detail: "exited twice" };
    const status = { kind: PluginStatusKind.Disabled, reason };
    const state = { entry: { path: "/plugins/a" }, manifest: null, status };
    expect(pluginRows([state], [], null, quiet)).toEqual([
      {
        source: "/plugins/a",
        manifest: null,
        status: PluginStatusKind.Disabled,
        issues: [reason],
        backoffUntil: null,
        staleListings: 0,
        unscannedListings: 0,
      },
    ]);
  });

  it("shows a plugin's backoff while it lasts and counts only its own stale listings", () => {
    const state = { entry: { path: "/plugins/shop" }, manifest: MANIFEST, status: loaded };
    const listings = [
      scanned("l1", SHOP, ListingStatus.Stale),
      scanned("l2", SHOP, ListingStatus.Active),
      scanned("l3", SHOP, ListingStatus.Stale),
      scanned("l4", OTHER, ListingStatus.Stale),
    ];
    const health = [
      { pluginId: OTHER, consecutiveBlocks: 1, backoffUntil: NOW },
      { pluginId: SHOP, consecutiveBlocks: 1, backoffUntil: LATER },
    ];
    expect(pluginRows([state], [], null, { health, scanned: listings, now: NOW })).toMatchObject([
      { backoffUntil: LATER, staleListings: OWN_STALE },
      { source: `listings of ${OTHER}` },
    ]);
  });

  it("shows no backoff once it ended, or for a plugin with no health record or none in effect", () => {
    const state = { entry: { path: "/plugins/shop" }, manifest: MANIFEST, status: loaded };
    const ended = { health: [{ pluginId: SHOP, consecutiveBlocks: 1, backoffUntil: NOW }], scanned: [], now: NOW };
    const cleared = { ...ended, health: [{ pluginId: SHOP, consecutiveBlocks: 0, backoffUntil: null }] };
    for (const activity of [ended, cleared, quiet]) {
      expect(pluginRows([state], [], null, activity)).toMatchObject([{ backoffUntil: null, staleListings: 0 }]);
    }
  });

  describe("Listings no plugin is scanning", () => {
    const disabled = { kind: PluginStatusKind.Disabled, reason: { kind: PluginIssueKind.Crashed, detail: "gone" } };
    const three = { ...quiet, scanned: [
      scanned("l1", SHOP, ListingStatus.Active),
      scanned("l2", SHOP, ListingStatus.Stale),
      scanned("l3", OTHER, ListingStatus.Active),
    ] };
    const shopRow = (status: typeof loaded | typeof disabled) =>
      ({ entry: { path: "/plugins/shop" }, manifest: MANIFEST, status });
    const otherManifest = { ...MANIFEST, id: OTHER };

    it("counts none for a loaded plugin", () => {
      const state = shopRow(loaded);
      const other = { entry: { path: "/plugins/other" }, manifest: otherManifest, status: loaded };
      expect(pluginRows([state, other], [], null, three)).toMatchObject([
        { unscannedListings: 0 },
        { unscannedListings: 0 },
      ]);
    });

    it("counts all of a disabled plugin's listings as not scanned", () => {
      const other = { entry: { path: "/plugins/other" }, manifest: otherManifest, status: loaded };
      expect(pluginRows([shopRow(disabled), other], [], null, three)).toMatchObject([
        { unscannedListings: TWO_OWN },
        { unscannedListings: 0 },
      ]);
    });

    it("adds one row per plugin id whose listings no plugin in plugins.json provides", () => {
      const repeated = { ...quiet, scanned: [...three.scanned, scanned("l4", OTHER, ListingStatus.Stale)] };
      expect(pluginRows([], [], null, repeated)).toEqual([
        {
          source: `listings of ${SHOP}`,
          manifest: null,
          status: PluginStatusKind.Disabled,
          issues: [{ kind: PluginIssueKind.NotListed, detail: NOT_LISTED }],
          backoffUntil: null,
          staleListings: 1,
          unscannedListings: TWO_OWN,
        },
        {
          source: `listings of ${OTHER}`,
          manifest: null,
          status: PluginStatusKind.Disabled,
          issues: [{ kind: PluginIssueKind.NotListed, detail: NOT_LISTED }],
          backoffUntil: null,
          staleListings: 1,
          unscannedListings: TWO_OWN,
        },
      ]);
    });

    it("adds no such row for a plugin that has a row of its own, loaded or disabled", () => {
      const other = { entry: { path: "/plugins/other" }, manifest: otherManifest, status: disabled };
      expect(pluginRows([shopRow(loaded), other], [], null, three)).toHaveLength(TWO_OWN);
    });

    it("adds such a row after a listed plugin that never reported its id, since nothing ties them", () => {
      const failed = { entry: { path: "/plugins/shop" }, manifest: null, status: disabled };
      const only = { ...quiet, scanned: [scanned("l1", SHOP, ListingStatus.Active)] };
      expect(pluginRows([failed], [], null, only)).toMatchObject([
        { source: "/plugins/shop", unscannedListings: 0 },
        { source: `listings of ${SHOP}`, unscannedListings: 1 },
      ]);
    });
  });

  it("gives rejected entries and an unusable plugins.json no backoff and no stale listings", () => {
    const issue = { kind: PluginIssueKind.EntryInvalid, detail: "no path" };
    const config = { kind: PluginIssueKind.ConfigInvalid, detail: "not JSON" };
    const activity = { ...quiet, scanned: [scanned("l1", SHOP, ListingStatus.Stale)] };
    expect(pluginRows([], [{ index: 0, issue }], config, activity)).toMatchObject([
      { manifest: null, backoffUntil: null, staleListings: 0, unscannedListings: 0 },
      { manifest: null, backoffUntil: null, staleListings: 0, unscannedListings: 0 },
      { source: `listings of ${SHOP}` },
    ]);
  });
});
