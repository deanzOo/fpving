import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { SpecSource } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { failWith, reply, wire } from "./support/fake-api.ts";
import { air75, CATALOG, gearApi, OTHER_CATALOG } from "./support/gear.ts";
import { renderApp } from "./support/render-app.tsx";
import "../src/styles.css";

type Match = z.output<typeof wire.catalog>["matches"][number];
type Found = Match["specs"][string][number];

const AIR75 = "BetaFPV Air75 II Freestyle";
const GOGGLES = "Box goggles";
const CHANNELS = 40;
const TWO = 2;
const AI_READ = "Read by AI, check it";
const PASTED = "Analog 5.8G FPV goggles, 40 channels, DVR";
const REF = { pluginId: CATALOG, key: "air75-ii" };

const from = (pluginId: Found["pluginId"], specs: Readonly<Record<string, Found["value"]>>) =>
  Object.entries(specs).map(([field, value]): [string, Found] => [field, { value, pluginId }]);

const merged = (...lists: [string, Found][][]) => {
  const specs: Record<string, Found[]> = {};
  for (const [field, value] of lists.flat()) {
    specs[field] = [...specs[field] ?? [], value];
  }
  return specs;
};

const QUAD_SPECS = { sizeClass: "whoop-75", cells: 1, rcLink: "elrs-2g4", videoSystem: "analog-5g8", connector: "bt2" };

const air75Match = (specs: Match["specs"], refs: Match["refs"] = [REF]): Match => ({
  name: AIR75, kind: GearKind.Quad, specs, refs,
});

const disagreeing = () => air75Match(
  merged(from(CATALOG, { rcLink: "elrs-2g4", videoSystem: "analog-5g8" }),
    from(OTHER_CATALOG, { rcLink: "elrs-2g4", videoSystem: "dji-o3", connector: "bt2" })),
  [REF, { pluginId: OTHER_CATALOG, key: "air75" }],
);

const searching = (query: string, matches: readonly Match[]) => {
  const api = gearApi([]);
  api.on(apiRoutes.searchCatalog, reply(wire.catalog, { matches: [...matches], failedPlugins: [], catalogs: 2 }),
    `?q=${query}`);
  api.on(apiRoutes.addGear, reply(wire.gearItem, air75(), HttpStatus.Created));
  return api;
};

const search = async (api: ReturnType<typeof searching>, query: string) => {
  const screen = await renderApp(api.client, "/gear");
  await screen.getByLabelText("Search the catalog").fill(query);
  await screen.getByRole("button", { name: "Search" }).click();
  return screen;
};

const pick = async (api: ReturnType<typeof searching>) => {
  const screen = await search(api, "air75");
  await screen.getByRole("button", { name: `Use ${AIR75}` }).click();
  await expect.element(screen.getByLabelText("Name")).toHaveValue(AIR75);
  return screen;
};

const saved = async (api: ReturnType<typeof searching>, screen: Awaited<ReturnType<typeof search>>) => {
  await screen.getByRole("button", { name: "Save" }).click();
  const added = () => api.sent.filter(({ method, path }) => method === "POST" && path === apiRoutes.addGear.url);
  await expect.poll(() => added()).toHaveLength(1);
  return added().map(({ body }) => body);
};

const reading = (answer: Parameters<ReturnType<typeof searching>["on"]>[1]) => {
  const api = searching("goggles", []);
  api.on(apiRoutes.readSpecs, answer);
  return api;
};

const read = async (api: ReturnType<typeof reading>) => {
  const screen = await search(api, "goggles");
  await expect.element(screen.getByText("No match in the catalog.")).toBeVisible();
  await screen.getByLabelText("Kind").selectOptions("Goggles");
  await screen.getByLabelText("Specs text").fill(PASTED);
  await screen.getByRole("button", { name: "Read specs" }).click();
  return screen;
};

const typeIn = async (api: ReturnType<typeof searching>, kind: string) => {
  const screen = await renderApp(api.client, "/gear");
  await screen.getByLabelText("Kind").selectOptions(kind);
  await screen.getByRole("button", { name: "Type them in" }).click();
  return screen;
};

describe("Adding gear", () => {
  it("pre-fills the form from a catalog match", async () => {
    const api = searching("air75", [air75Match(merged(from(CATALOG, QUAD_SPECS)))]);
    const screen = await pick(api);
    await expect.element(screen.getByLabelText("Size")).toHaveValue("whoop-75");
    await expect.element(screen.getByLabelText("Cells")).toHaveValue("1");
    await expect.element(screen.getByLabelText("Video system")).toHaveValue("analog-5g8");
    expect(await saved(api, screen)).toEqual([{
      kind: GearKind.Quad,
      name: AIR75,
      quantity: 1,
      catalogRef: REF,
      specs: Object.fromEntries(Object.entries(QUAD_SPECS).map(([field, value]) => [
        field, { source: SpecSource.Catalog, pluginId: CATALOG, value },
      ])),
    }]);
  });

  it("shows both values when catalogs disagree and saves the picked one as confirmed by the user", async () => {
    const api = searching("air75", [disagreeing()]);
    const screen = await search(api, "air75");
    const result = screen.getByRole("listitem").filter({ hasText: AIR75 });
    await expect.element(result.getByText("Analog 5.8GHz", { exact: true })).toBeVisible();
    await expect.element(result.getByText("DJI O3", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: `Use ${AIR75}` }).click();
    const video = screen.getByLabelText("Video system");
    await expect.element(video).toHaveValue("");
    await expect.element(video).toHaveAccessibleDescription(/The catalogs disagree/u);
    await video.selectOptions("DJI O3");
    const [sent] = await saved(api, screen);
    expect(sent).toMatchObject({
      catalogRef: REF,
      specs: {
        rcLink: { source: SpecSource.Catalog, pluginId: CATALOG, value: "elrs-2g4" },
        videoSystem: { source: SpecSource.User, value: "dji-o3" },
        connector: { source: SpecSource.User, value: "bt2" },
      },
    });
  });

  it("leaves a disagreement unknown when Not sure is kept", async () => {
    const api = searching("air75", [disagreeing()]);
    const screen = await pick(api);
    await expect.element(screen.getByLabelText("Video system")).toHaveDisplayValue("Not sure");
    const [sent] = await saved(api, screen);
    expect(sent).toMatchObject({ specs: { rcLink: { source: SpecSource.Catalog } } });
    expect(sent).not.toHaveProperty("specs.videoSystem");
  });

  it("marks AI readings for checking and saves them only on Save", async () => {
    const api = reading(reply(wire.read, {
      name: GOGGLES, specs: { kind: GearKind.Goggles, videoSystems: ["analog-5g8"], channels: CHANNELS },
    }));
    const screen = await read(api);
    await expect.element(screen.getByLabelText("Name")).toHaveValue(GOGGLES);
    await expect.element(screen.getByLabelText("Name")).toHaveAccessibleDescription(AI_READ);
    await expect.element(screen.getByLabelText("Channels")).toHaveAccessibleDescription(AI_READ);
    const systems = screen.getByRole("group", { name: "Video systems" });
    await expect.element(systems.getByText(AI_READ)).toBeVisible();
    await expect.element(systems.getByLabelText("Analog 5.8GHz")).toBeChecked();
    expect(api.sent.filter(({ method }) => method === "POST").map(({ path }) => path))
      .toEqual([apiRoutes.readSpecs.url]);
    expect(await saved(api, screen)).toEqual([{
      kind: GearKind.Goggles,
      name: GOGGLES,
      quantity: 1,
      catalogRef: null,
      specs: {
        videoSystems: { source: SpecSource.User, value: ["analog-5g8"] },
        channels: { source: SpecSource.User, value: CHANNELS },
      },
    }]);
  });

  it("offers hand entry when no key is set", async () => {
    const api = reading(failWith(HttpStatus.ServiceUnavailable, ApiErrorKind.Unavailable, "no key"));
    const screen = await read(api);
    await expect.element(screen.getByText("The AI that reads specs is not available, so type the specs in by hand."))
      .toBeVisible();
    await expect.element(screen.getByLabelText("Name")).toHaveValue("");
    await expect.element(screen.getByLabelText("Channels")).toHaveValue("");
    await expect.element(screen.getByLabelText("Channels")).not.toHaveAccessibleDescription(AI_READ);
  });

  it("leaves the name empty and unmarked when the AI could not read it", async () => {
    const api = reading(reply(wire.read, { name: null, specs: { kind: GearKind.Goggles, channels: CHANNELS } }));
    const screen = await read(api);
    await expect.element(screen.getByLabelText("Channels")).toHaveValue(String(CHANNELS));
    await expect.element(screen.getByLabelText("Name")).toHaveValue("");
    await expect.element(screen.getByLabelText("Name")).not.toHaveAccessibleDescription(AI_READ);
  });

  it("says when the AI could not read the text, and keeps it for another try", async () => {
    const api = reading(failWith(HttpStatus.BadGateway, ApiErrorKind.MalformedOutput, "the AI answered nonsense"));
    const screen = await read(api);
    await expect.element(screen.getByRole("alert").getByText("the AI answered nonsense")).toBeVisible();
    await expect.element(screen.getByLabelText("Specs text")).toHaveValue(PASTED);
  });

  it("takes a charger's cell counts as a list and its connectors as ticks", async () => {
    const api = searching("air75", []);
    const screen = await typeIn(api, "Charger");
    await expect.element(screen.getByLabelText("Cells")).toHaveAccessibleDescription("Separate values with commas.");
    await screen.getByLabelText("Name").fill("ViFly WhoopStor 3");
    await screen.getByLabelText("Cells").fill("1, 2");
    const connectors = screen.getByRole("group", { name: "Connectors" });
    await connectors.getByLabelText("PH2.0").click();
    await connectors.getByLabelText("BT2.0").click();
    await connectors.getByLabelText("PH2.0").click();
    const [sent] = await saved(api, screen);
    expect(sent).toMatchObject({
      kind: GearKind.Charger,
      specs: {
        cells: { source: SpecSource.User, value: [1, TWO] },
        connectors: { source: SpecSource.User, value: ["bt2"] },
      },
    });
    expect(sent).not.toHaveProperty("specs.ports");
  });

  it("saves nothing until the name, the quantity and every count are valid", async () => {
    const api = searching("air75", []);
    const screen = await typeIn(api, "Charger");
    await screen.getByLabelText("Quantity").fill("0");
    await screen.getByLabelText("Cells").fill("1, 1");
    await screen.getByLabelText("Ports").fill("1.5");
    await screen.getByRole("button", { name: "Save" }).click();
    await expect.element(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Enter a name\./u);
    await expect.element(screen.getByLabelText("Name")).toHaveFocus();
    await expect.element(screen.getByLabelText("Quantity")).toHaveAccessibleDescription(/Enter a whole number/u);
    await expect.element(screen.getByLabelText("Ports")).toHaveAccessibleDescription(/Enter a whole number/u);
    await expect.element(screen.getByLabelText("Cells")).toHaveAccessibleDescription(/Enter whole numbers/u);
    expect(api.sent.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("closes the form without saving on Cancel", async () => {
    const api = searching("air75", []);
    const screen = await typeIn(api, "Radio");
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect.element(screen.getByLabelText("Name")).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText("Specs text")).toBeVisible();
    expect(api.sent.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("says no catalog is installed when there is none", async () => {
    const screen = await renderApp(gearApi([], []).client, "/gear");
    await expect.element(screen.getByText(/^No catalog plugin installed\. Paste the specs or type them in\./u))
      .toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Plugins", exact: true }).last())
      .toHaveAttribute("href", "/plugins");
    await expect.element(screen.getByLabelText("Search the catalog")).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText("Specs text")).toBeVisible();
  });
});
