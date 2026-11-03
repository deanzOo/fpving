import { ApiErrorKind } from "@fpving/app/errors";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ApiFailure, ClientErrorKind } from "../src/client.ts";
import { Refused } from "../src/refusal.tsx";
import { rgb, styleOf, token } from "./support/style.ts";
import "../src/styles.css";

const MESSAGE = "The store said no.";

describe("Refused notice", () => {
  it.each([
    [ApiErrorKind.InvalidRequest, "Refused"],
    [ApiErrorKind.PluginUnavailable, "Refused"],
    [ApiErrorKind.Starting, "Refused"],
    [ApiErrorKind.FetchFailed, "Failed"],
    [ApiErrorKind.SettingsNotApplied, "Failed"],
    [ApiErrorKind.Internal, "Failed"],
    [ClientErrorKind.Unreachable, "Failed"],
    [ClientErrorKind.BadResponse, "Failed"],
    [ClientErrorKind.Unexpected, "Failed"],
  ])("announces %s as an alert tagged %s", async (kind, tag) => {
    const screen = await render(<Refused error={new ApiFailure(kind, MESSAGE)} />);
    const alert = screen.getByRole("alert");
    await expect.element(alert.getByText(tag, { exact: true })).toBeVisible();
    expect(styleOf(alert.getByText(tag, { exact: true })).color).toBe(rgb(token("--color-critical")));
  });

  it("says a restart politely, as a warning tagged Restarting", async () => {
    const screen = await render(<Refused error={new ApiFailure(ApiErrorKind.Restarting, MESSAGE)} />);
    const status = screen.getByRole("status");
    await expect.element(status.getByText("Restarting", { exact: true })).toBeVisible();
    expect(styleOf(status.getByText("Restarting", { exact: true })).color).toBe(rgb(token("--color-warning")));
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });
});
