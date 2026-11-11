const entries = [
  {
    key: "radiomaster-boxer-crush",
    name: "RadioMaster Boxer Crush",
    specs: { kind: "radio", rcLink: "elrs-2g4", firmware: "edgetx" },
  },
  {
    key: "eachine-ev800d",
    name: "Eachine EV800D",
    specs: { kind: "goggles", videoSystems: ["analog-5g8"], channels: 40 },
  },
  {
    key: "lava-ii-480",
    name: "LAVA II 480",
    specs: { kind: "battery", cells: 1, chemistry: "lihv", capacityMah: 480, connector: "bt2" },
  },
  { key: "broken-frame", name: "Broken Frame", specs: { kind: "quad", sizeClass: "9in" } },
];

export default {
  manifest: {
    kind: "catalog",
    id: "fixture-catalog",
    displayName: "Fixture Catalog",
    version: "1.0.0",
    sdkVersion: ">=0.0.0 <1.0.0",
  },
  createCatalog: (ctx) => {
    if (ctx.http !== undefined || ctx.browser !== undefined) {
      throw new Error("a catalog must not get http or browser");
    }
    return {
      search: async (text) => ({
        ok: true,
        value: entries.filter(({ name }) => name.toLowerCase().includes(text.toLowerCase())),
      }),
      get: async (key) => ({ ok: true, value: entries.find((entry) => entry.key === key) ?? null }),
    };
  },
};
