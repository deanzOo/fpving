import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Slider } from "../../src/ui/slider.tsx";
import "../../src/styles.css";

const MOVED_TO = 75;

describe("Slider", () => {
  it("is named by its label and shows its value", async () => {
    const screen = await render(<Slider label="Explode" value={40} onChange={vi.fn()} />);
    await expect.element(screen.getByRole("slider", { name: "Explode" })).toHaveValue("40");
  });

  it("reports a new value as a number", async () => {
    const onChange = vi.fn();
    const screen = await render(<Slider label="Explode" value={0} onChange={onChange} />);
    await screen.getByRole("slider").fill(String(MOVED_TO));
    expect(onChange).toHaveBeenLastCalledWith(MOVED_TO);
  });
});
