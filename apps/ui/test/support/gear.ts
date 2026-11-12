import { apiRoutes } from "@fpving/app/api-routes";
import { gearItemIdSchema, pluginIdSchema, SpecSource } from "@fpving/core";
import type { GearItem } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import type { z } from "zod";
import { fakeApi, reply, wire } from "./fake-api.ts";

type Changes = z.output<typeof wire.gear>[number]["changes"];
type JsonValue = z.core.util.JSONType;

/** The catalog plugin Dean's quad came from. */
export const CATALOG = pluginIdSchema.parse("betafpv");

/** A second catalog plugin. */
export const OTHER_CATALOG = pluginIdSchema.parse("fpvwiki");

const userSpecs = (specs: Readonly<Record<string, JsonValue>>) =>
  Object.fromEntries(Object.entries(specs).map(([field, value]) => [field, { source: SpecSource.User, value }]));

/** A gear item whose specs the user confirmed. */
export const owned = (
  id: string,
  kind: GearItem["kind"],
  name: string,
  specs: Readonly<Record<string, JsonValue>>,
  quantity = 1,
): GearItem => ({
  id: gearItemIdSchema.parse(id),
  kind,
  name,
  quantity,
  createdAt: new Date("2026-11-01T08:00:00.000Z"),
  catalogRef: null,
  specs: userSpecs(specs),
});

/** Dean's quad, its specs from the BetaFPV catalog. */
export const air75 = (): GearItem => ({
  ...owned("g-quad", GearKind.Quad, "BetaFPV Air75 II Freestyle", {}),
  catalogRef: { pluginId: CATALOG, key: "air75-ii" },
  specs: Object.fromEntries(Object.entries({
    sizeClass: "whoop-75", cells: 1, rcLink: "elrs-2g4", videoSystem: "analog-5g8", connector: "bt2",
  }).map(([field, value]) => [field, { source: SpecSource.Catalog, pluginId: CATALOG, value }])),
});

const BATTERIES = 8;
const CHANNELS = 40;
const MAH = 480;
const PORTS = 6;

/** The LAVA II batteries Dean owns. */
export const lava = (): GearItem => owned("g-battery", GearKind.Battery, "BetaFPV LAVA II 480mAh", {
  cells: 1, chemistry: "lihv", capacityMah: MAH, connector: "bt2",
}, BATTERIES);

/** Everything Dean owns, from the mockup. */
export const deansGear = (): GearItem[] => [
  owned("g-radio", GearKind.Radio, "RadioMaster Boxer Crush", { rcLink: "elrs-2g4", firmware: "edgetx" }),
  owned("g-goggles", GearKind.Goggles, "Box goggles (unbranded, EV800D-style)", {
    videoSystems: ["analog-5g8"], channels: CHANNELS,
  }),
  air75(),
  lava(),
  owned("g-charger", GearKind.Charger, "ViFly WhoopStor 3", { cells: [1], connectors: ["bt2", "ph2"], ports: PORTS }),
  owned("g-kit", GearKind.Tool, "iFixit 64-bit kit", { toolType: "precision-kit" }),
  owned("g-mat", GearKind.Tool, "Anti-static mat", { toolType: "esd-mat" }),
  owned("g-tweezers", GearKind.Tool, "Tweezers", { toolType: "tweezers" }),
];

const catalogPlugin = (): z.output<typeof wire.plugins>[number] => ({
  source: "./plugins/betafpv",
  manifest: { kind: "catalog", id: CATALOG, displayName: "BetaFPV", version: "1.0.0", sdkVersion: ">=0.0.0 <1.0.0" },
  status: wire.plugins.element.shape.status.enum.Loaded,
  issues: [],
  backoffUntil: null,
  staleListings: 0,
  unscannedListings: 0,
});

/** The API with `items` owned, each with its `changes`, and the plugins `plugins` loaded. */
export const gearApi = (
  items: readonly GearItem[],
  plugins = [catalogPlugin()],
  changes: Readonly<Record<string, Changes>> = {},
): ReturnType<typeof fakeApi> => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.listPlugins, reply(wire.plugins, plugins));
  api.on(apiRoutes.listGear, reply(wire.gear, items.map((item) => ({ item, changes: changes[item.id] ?? [] }))));
  return api;
};

/** The bodies sent with `method` so far. */
export const sentWith = (api: ReturnType<typeof fakeApi>, method: string): unknown[] =>
  api.sent.filter((request) => request.method === method).map(({ body }) => body);
