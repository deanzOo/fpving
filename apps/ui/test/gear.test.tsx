import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { SpecSource } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { at, failWith, gate, heldBy, noContent, reply, wire } from "./support/fake-api.ts";
import { air75, CATALOG, deansGear, gearApi, lava, owned, sentWith } from "./support/gear.ts";
import { renderApp } from "./support/render-app.tsx";
import { expectBadge } from "./support/style.ts";
import "../src/styles.css";

const KINDS = ["Radios", "Goggles", "Quads", "Batteries", "Chargers", "Tools"];
const CHANGED = { "g-quad": [{ field: "videoSystem", saved: "analog-5g8", catalog: "dji-o4" }] };
const TEN = 10;
const MAH_450 = 450;

const open = async (api = gearApi(deansGear())) => {
  const screen = await renderApp(api.client, "/gear");
  await expect.element(screen.getByRole("heading", { name: "My gear", level: 1 })).toBeVisible();
  await expect.element(screen.getByRole("region", { name: "Radios" })).toBeVisible();
  return screen;
};

const changedApi = () => {
  const api = gearApi(deansGear(), undefined, CHANGED);
  api.on(at(apiRoutes.updateGear, { gearId: "g-quad" }), reply(wire.gearItem, air75()));
  return api;
};

const openChange = async (api: ReturnType<typeof changedApi>) => {
  const screen = await open(api);
  await screen.getByRole("button", { name: "Changed: Video system" }).click();
  return screen;
};

describe("My gear", () => {
  it("groups gear by kind with spec tags", async () => {
    const screen = await open();
    const kinds = screen.getByRole("heading", { level: 2 }).elements().map(({ textContent }) => textContent)
      .filter((text) => KINDS.includes(text));
    expect(kinds).toEqual(KINDS);
    const batteries = screen.getByRole("region", { name: "Batteries" });
    await expect.element(batteries.getByRole("heading", { name: "BetaFPV LAVA II 480mAh ×8", level: 3 }))
      .toBeVisible();
    for (const tag of ["1S", "LiHV", "480mAh", "BT2.0"]) {
      await expect.element(batteries.getByText(tag, { exact: true })).toBeVisible();
    }
    const charger = screen.getByRole("region", { name: "Chargers" });
    for (const tag of ["1S", "BT2.0", "PH2.0", "6 ports"]) {
      await expect.element(charger.getByText(tag, { exact: true })).toBeVisible();
    }
    const goggles = screen.getByRole("region", { name: "Goggles" });
    await expect.element(goggles.getByText("Analog 5.8GHz", { exact: true })).toBeVisible();
    await expect.element(goggles.getByText("40 ch", { exact: true })).toBeVisible();
    const tools = screen.getByRole("region", { name: "Tools" });
    await expect.element(tools.getByRole("heading", { name: "Anti-static mat" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "RadioMaster Boxer Crush", exact: true })).toBeVisible();
  });

  it("shows a tag only for the specs that are known", async () => {
    const screen = await open(gearApi([owned("g-radio", GearKind.Radio, "Jumper T-Pro", { firmware: "edgetx" })]));
    const radios = screen.getByRole("region", { name: "Radios" });
    await expect.element(radios.getByText("EdgeTX", { exact: true })).toBeVisible();
    expect(radios.getByText("Radio link:").elements()).toHaveLength(0);
  });

  it("says what to do when nothing is owned yet", async () => {
    const screen = await renderApp(gearApi([]).client, "/gear");
    await expect.element(screen.getByText("Nothing in your gear yet. Search for something you own above to add it."))
      .toBeVisible();
  });

  it("says to paste or type specs in when nothing is owned and no catalog can be searched", async () => {
    const screen = await renderApp(gearApi([], []).client, "/gear");
    await expect.element(screen.getByText("Nothing in your gear yet. Paste the specs or type them in above to add it."))
      .toBeVisible();
  });

  it("shows a changed catalog value with its word, glyph and colour", async () => {
    const screen = await open(changedApi());
    await expectBadge(screen.getByText("Changed", { exact: true }), "▲", "--color-warning");
    const changed = screen.getByRole("button", { name: "Changed: Video system" });
    await expect.element(changed).toHaveAttribute("aria-expanded", "false");
    await changed.click();
    await expect.element(changed).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("You saved Analog 5.8GHz. The catalog now says DJI O4.")).toBeVisible();
    await changed.click();
    await expect.element(changed).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByRole("button", { name: "Keep mine" })).not.toBeInTheDocument();
  });

  it("keeps the user's value when Keep mine is chosen", async () => {
    const api = changedApi();
    const screen = await openChange(api);
    await screen.getByRole("button", { name: "Keep mine" }).click();
    await expect.poll(() => sentWith(api, "PATCH")).toHaveLength(1);
    await expect.element(screen.getByRole("heading", { name: "BetaFPV Air75 II Freestyle", level: 3 })).toHaveFocus();
    const { kind, name, quantity, catalogRef, specs } = air75();
    expect(sentWith(api, "PATCH")).toEqual([{
      kind, name, quantity, catalogRef,
      specs: { ...specs, videoSystem: { source: SpecSource.User, value: "analog-5g8" } },
    }]);
    await expect.element(screen.getByText("You saved Analog 5.8GHz. The catalog now says DJI O4."))
      .not.toBeInTheDocument();
  });

  it.each([
    ["Keep mine", "Keeping…", "Use catalog"],
    ["Use catalog", "Updating…", "Keep mine"],
  ])("marks only %s as pending while it saves", async (action, pendingLabel, other) => {
    const held = gate();
    const api = changedApi();
    api.on(at(apiRoutes.updateGear, { gearId: "g-quad" }), heldBy(held, reply(wire.gearItem, air75())));
    const screen = await openChange(api);
    await screen.getByRole("button", { name: action }).click();
    await expect.element(screen.getByRole("button", { name: pendingLabel })).toHaveAttribute("aria-disabled", "true");
    await expect.element(screen.getByRole("button", { name: other })).toHaveAttribute("aria-disabled", "false");
    held.release();
  });

  it("takes the catalog's value when Use catalog is chosen", async () => {
    const api = changedApi();
    const screen = await openChange(api);
    await screen.getByRole("button", { name: "Use catalog" }).click();
    await expect.poll(() => sentWith(api, "PATCH")).toHaveLength(1);
    const [sent] = sentWith(api, "PATCH");
    expect(sent).toMatchObject({
      specs: { videoSystem: { source: SpecSource.Catalog, pluginId: CATALOG, value: "dji-o4" } },
    });
  });

  it("edits an item's quantity and specs", async () => {
    const api = gearApi(deansGear());
    api.on(at(apiRoutes.updateGear, { gearId: "g-battery" }), reply(wire.gearItem, lava()));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Edit BetaFPV LAVA II 480mAh" }).click();
    await expect.element(screen.getByLabelText("Name")).toHaveValue("BetaFPV LAVA II 480mAh");
    await expect.element(screen.getByLabelText("Name")).toHaveFocus();
    await expect.element(screen.getByLabelText("Chemistry")).toHaveValue("lihv");
    await expect.element(screen.getByLabelText("Chemistry")).toHaveAccessibleDescription("Confirmed by you");
    await screen.getByLabelText("Quantity").fill(String(TEN));
    await screen.getByLabelText("Capacity (mAh)").fill(String(MAH_450));
    await screen.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => sentWith(api, "PATCH")).toHaveLength(1);
    expect(sentWith(api, "PATCH")).toEqual([{
      kind: GearKind.Battery,
      name: "BetaFPV LAVA II 480mAh",
      quantity: TEN,
      catalogRef: null,
      specs: {
        cells: { source: SpecSource.User, value: 1 },
        chemistry: { source: SpecSource.User, value: "lihv" },
        capacityMah: { source: SpecSource.User, value: MAH_450 },
        connector: { source: SpecSource.User, value: "bt2" },
      },
    }]);
    await expect.element(screen.getByLabelText("Name")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Edit BetaFPV LAVA II 480mAh" })).toHaveFocus();
  });

  it("keeps catalog values from their catalog when an item is edited", async () => {
    const api = gearApi(deansGear());
    api.on(at(apiRoutes.updateGear, { gearId: "g-quad" }), reply(wire.gearItem, air75()));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Edit BetaFPV Air75 II Freestyle" }).click();
    await expect.element(screen.getByLabelText("Video system")).toHaveAccessibleDescription("From BetaFPV");
    await screen.getByLabelText("Quantity").fill("2");
    await screen.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => sentWith(api, "PATCH")).toHaveLength(1);
    const { catalogRef, specs } = air75();
    expect(sentWith(api, "PATCH")).toEqual([expect.objectContaining({ quantity: 2, catalogRef, specs })]);
  });

  it("leaves an item as it was when its edit is cancelled", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Edit BetaFPV LAVA II 480mAh" }).click();
    await screen.getByLabelText("Quantity").fill(String(TEN));
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect.element(screen.getByRole("heading", { name: "BetaFPV LAVA II 480mAh ×8" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Edit BetaFPV LAVA II 480mAh" })).toHaveFocus();
  });

  it("removes an item only after Confirm", async () => {
    const api = gearApi(deansGear());
    api.on(at(apiRoutes.removeGear, { gearId: "g-mat" }), noContent);
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove Anti-static mat" }).click();
    const dialog = screen.getByRole("dialog", { name: "Remove Anti-static mat from your gear?" });
    await expect.element(dialog).toBeVisible();
    expect(sentWith(api, "DELETE")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => api.sent.filter(({ method }) => method === "DELETE").map(({ path }) => path))
      .toEqual(["/api/gear/g-mat"]);
  });

  it("moves focus to the item now in the removed one's place", async () => {
    const api = gearApi(deansGear());
    api.on(at(apiRoutes.removeGear, { gearId: "g-mat" }), () => {
      api.on(apiRoutes.listGear, reply(wire.gear, deansGear().filter(({ id }) => id !== "g-mat")
        .map((item) => ({ item, changes: [] }))));
      return noContent();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove Anti-static mat" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.element(screen.getByRole("heading", { name: "Anti-static mat" })).not.toBeInTheDocument();
    const focused = () => document.activeElement;
    await expect.poll(() => focused()?.tagName).toBe("LI");
    expect(focused()?.querySelector("h3")?.textContent.trim()).toBe("Tweezers");
  });

  it("says when an item could not be removed, and keeps it", async () => {
    const api = gearApi(deansGear());
    api.on(at(apiRoutes.removeGear, { gearId: "g-mat" }),
      failWith(HttpStatus.NotFound, ApiErrorKind.GearNotFound, "no gear has this id"));
    const screen = await open(api);
    await screen.getByRole("button", { name: "Remove Anti-static mat" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.element(screen.getByRole("alert").getByText("no gear has this id")).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "Anti-static mat" })).toBeVisible();
  });
});
