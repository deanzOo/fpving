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

  it("holds an empty status region with no error, and says a restart in that same region", async () => {
    const screen = await render(<Refused error={null} />);
    const region = screen.getByRole("status");
    await expect.element(region).toBeEmptyDOMElement();
    const before = region.element();
    await screen.rerender(<Refused error={new ApiFailure(ApiErrorKind.Restarting, MESSAGE)} />);
    await expect.element(region.getByText("Restarting", { exact: true })).toBeVisible();
    expect(region.element()).toBe(before);
  });

  it("goes back to an empty status region once an alert is over", async () => {
    const screen = await render(<Refused error={new ApiFailure(ApiErrorKind.Internal, MESSAGE)} />);
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await screen.rerender(<Refused error={null} />);
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    [ApiErrorKind.Restarting, "Restarting"],
    [ApiErrorKind.Starting, "Starting"],
  ])("says %s politely, as a warning tagged %s", async (kind, tag) => {
    const screen = await render(<Refused error={new ApiFailure(kind, MESSAGE)} />);
    const status = screen.getByRole("status");
    await expect.element(status.getByText(tag, { exact: true })).toBeVisible();
    expect(styleOf(status.getByText(tag, { exact: true })).color).toBe(rgb(token("--color-warning")));
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });
});
