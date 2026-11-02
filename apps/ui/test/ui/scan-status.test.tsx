import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ScanStatus } from "../../src/ui/scan-status.tsx";
import { prefersReducedMotion } from "../support/media.ts";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const RUNNING = "Scanning every listing…";
const IDLE = "Last scan finished 4 minutes ago.";
const BLINK = "blink";
const SWEEP = "sweep";

const scan = async (running: boolean, starting = false) => {
  const onStart = vi.fn();
  const screen = await render(
    <ScanStatus running={running} starting={starting} onStart={onStart}>{running ? RUNNING : IDLE}</ScanStatus>,
  );
  return { screen, onStart, button: screen.getByRole("button", { name: "Scan now" }) };
};

const marks = (container: HTMLElement) => {
  const rec = container.querySelector(".rec");
  const sweep = container.querySelector(".sweep");
  if (rec === null || sweep === null) {
    throw new Error("no scan marks");
  }
  return {
    dot: getComputedStyle(rec, "::before"),
    sweep: getComputedStyle(sweep, "::after"),
    track: getComputedStyle(sweep).width,
  };
};

describe("Scan status", () => {
  it("while idle says the last result and starts a scan", async () => {
    const { screen, onStart, button } = await scan(false);
    await expect.element(screen.getByRole("status")).toHaveTextContent(IDLE);
    await expect.element(screen.getByText("Scanning", { exact: true })).not.toBeInTheDocument();
    await button.click();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("while running shows the blinking dot and the sweep, and the button does nothing", async () => {
    const { screen, onStart, button } = await scan(true);
    await expect.element(screen.getByRole("status")).toHaveTextContent(RUNNING);
    expect(styleOf(screen.getByText("Scanning", { exact: true })).color).toBe(rgb(token("--color-signal")));
    const { dot, sweep } = marks(screen.container);
    expect(dot.animationName).toBe(BLINK);
    expect(sweep.animationName).toBe(SWEEP);
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await button.click({ force: true });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps the dot lit and the sweep solid under reduced motion", async () => {
    await prefersReducedMotion();
    const { screen } = await scan(true);
    const { dot, sweep, track } = marks(screen.container);
    expect(dot.animationName).toBe("none");
    expect(dot.visibility).toBe("visible");
    expect(sweep.animationName).toBe("none");
    expect(sweep.width).toBe(track);
  });

  it("holds the button while a start is on its way", async () => {
    const { button } = await scan(false, true);
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
  });
});
