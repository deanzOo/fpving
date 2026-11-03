import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import type { PlainErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { DEFAULT_SETTINGS, settingsSchema, ThresholdBasis } from "@fpving/core";
import type { Settings } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { QueryKey } from "../src/queries.ts";
import { failWith, fakeApi, reply, wire, Role } from "./support/fake-api.ts";
import { renderApp } from "./support/render-app.tsx";
import { styleOf } from "./support/style.ts";
import "../src/styles.css";

const saved = settingsSchema.parse(DEFAULT_SETTINGS);
const SIX_HOURS = 6;
const VAT_17_5 = 1750;
const THRESHOLD_150_EUR = 15_000;

const scripted = () => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), "?unread=true");
  api.on(apiRoutes.getSettings, reply(wire.settings, saved));
  return api;
};

const open = async (api = scripted()) => {
  const screen = await renderApp(api.client, "/settings");
  await expect.element(screen.getByLabelText("Scan every (hours)")).toHaveValue(String(saved.scanIntervalHours));
  return screen;
};

const saveWith = (api: ReturnType<typeof scripted>) => {
  api.on(apiRoutes.putSettings, () => {
    const [sent] = api.sent.filter(({ method }) => method === "PUT").slice(-1);
    return reply(wire.settings, settingsSchema.parse(sent?.body))();
  });
};

describe("Settings", () => {
  it("shows every saved setting in a labelled field", async () => {
    const screen = await open();
    await expect.element(screen.getByLabelText("Display currency")).toHaveValue("ILS");
    await expect.element(screen.getByLabelText("Ship to")).toHaveValue("IL");
    await expect.element(screen.getByLabelText("Duty-free threshold", { exact: true })).toHaveValue("75.00");
    await expect.element(screen.getByLabelText("Threshold currency")).toHaveValue("USD");
    await expect.element(screen.getByLabelText("VAT (%)")).toHaveValue("18.00");
    await expect.element(screen.getByLabelText("Threshold applies to")).toHaveValue(ThresholdBasis.Item);
    await expect.element(screen.getByLabelText("Price drop alert from (%)")).toHaveValue("5.00");
  });

  it.each(["Duty-free threshold", "VAT (%)", "Scan every (hours)", "Price drop alert from (%)"])(
    "types %s in the readout face", async (label) => {
      const screen = await open();
      expect(styleOf(screen.getByLabelText(label, { exact: true })).fontFamily).toContain("Martian Mono");
    },
  );

  it("offers exactly the values the settings schema allows in each select", async () => {
    const screen = await open();
    const options = (label: string) =>
      [...screen.getByLabelText(label).element().querySelectorAll("option")].map(({ value }) => value);
    expect(options("Display currency")).toEqual(settingsSchema.shape.displayCurrency.options);
    expect(options("Ship to")).toEqual(settingsSchema.shape.shipToCountry.options);
    expect(options("Threshold applies to")).toEqual(Object.values(ThresholdBasis));
  });

  it("saves the changed settings as minor units and basis points, and says so", async () => {
    const api = scripted();
    saveWith(api);
    const screen = await open(api);
    await screen.getByLabelText("Scan every (hours)").fill(String(SIX_HOURS));
    await screen.getByLabelText("VAT (%)").fill("17.5");
    await screen.getByLabelText("Display currency").selectOptions("USD");
    await screen.getByLabelText("Ship to").selectOptions("DE");
    await screen.getByLabelText("Threshold currency").selectOptions("EUR");
    await screen.getByLabelText("Duty-free threshold", { exact: true }).fill("150");
    await screen.getByLabelText("Threshold applies to").selectOptions(ThresholdBasis.ItemAndShipping);
    await screen.getByRole("button", { name: "Save settings" }).click();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Done Settings saved.");
    const expected: Settings = {
      ...saved, displayCurrency: "USD", shipToCountry: "DE", scanIntervalHours: SIX_HOURS,
      importTax: {
        dutyFreeThreshold: { amountMinor: THRESHOLD_150_EUR, currency: "EUR" }, vatBasisPoints: VAT_17_5,
        thresholdBasis: ThresholdBasis.ItemAndShipping,
      },
    };
    expect(api.sent).toContainEqual({ method: "PUT", path: apiRoutes.putSettings.url, body: expected });
  });

  it("marks every cached read that depends on the settings stale once saved, so landed costs refresh", async () => {
    const api = scripted();
    saveWith(api);
    const screen = await open(api);
    const dependent = [[...QueryKey.Product, "p1"], QueryKey.Watchlist, QueryKey.Plugins];
    for (const key of dependent) {
      screen.queryClient.setQueryData(key, []);
    }
    await screen.getByRole("button", { name: "Save settings" }).click();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Done Settings saved.");
    const stale = dependent.map((key) => screen.queryClient.getQueryState(key)?.isInvalidated);
    expect(stale).toEqual([true, true, true]);
  });

  it.each([
    ["Scan every (hours)", "0", "Enter a whole number of hours, at least 1."],
    ["Scan every (hours)", "1.5", "Enter a whole number of hours, at least 1."],
    ["Duty-free threshold", "75.001", "Enter an amount in USD, with at most 2 decimals."],
    ["VAT (%)", "abc", "Enter a percentage with at most 2 decimals."],
    ["Price drop alert from (%)", "", "Enter a percentage with at most 2 decimals."],
  ])("refuses %s %j next to the field and sends nothing", async (label, typed, said) => {
    const api = scripted();
    const screen = await open(api);
    const field = screen.getByLabelText(label, { exact: true });
    await field.fill(typed);
    await screen.getByRole("button", { name: "Save settings" }).click();
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
    await expect.element(field).toHaveAccessibleDescription(said);
    expect(api.sent.filter(({ method }) => method === "PUT")).toEqual([]);
  });

  it.each([
    [ApiErrorKind.SettingsNotApplied, Role.Alert, "Failed The settings were not applied and the old ones still hold. "
    + "See the log, then try again."],
    [ApiErrorKind.Restarting, Role.Status,
      "Restarting fpving is restarting its plugins for a settings change. Try again in a moment."],
    [ApiErrorKind.ShuttingDown, Role.Alert, "Refused fpving is shutting down."],
  ] satisfies [PlainErrorKind, Role, string][])("explains a %s refusal and saves on retry", async (
    kind, role, said,
  ) => {
    const api = scripted();
    api.on(apiRoutes.putSettings, () => {
      saveWith(api);
      return failWith(HttpStatus.ServiceUnavailable, kind, "refused")();
    });
    const screen = await open(api);
    await screen.getByRole("button", { name: "Save settings" }).click();
    await expect.element(screen.getByRole(role).filter({ hasText: said })).toHaveTextContent(said);
    await screen.getByRole("button", { name: "Save settings" }).click();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Done Settings saved.");
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });
});
