import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { userEvent } from "vitest/browser";
import {
  axisProps, ChartTooltip, cursorProps, gridProps, Legend, lineProps, SERIES,
} from "../../src/ui/chart-theme.tsx";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const WIDTH = 320;
const HEIGHT = 160;
const SERIES_SLOTS = 8;
const LONE = 4200;
const BEFORE = 4100;
const AFTER = 4000;
const VALUES = [null, LONE, null, BEFORE, AFTER] as const;

const two = [
  { key: "a", name: "fpv-shop: Source One V5", color: SERIES[0] },
  { key: "b", name: "quadparts: TBS Source One V5", color: SERIES[1] },
] as const;

describe("Chart theme", () => {
  it("has eight series colours in the fixed token order", () => {
    expect(SERIES).toHaveLength(SERIES_SLOTS);
    SERIES.forEach((color, index) => {
      expect(color).toBe(`var(--color-series-${String(index + 1)})`);
      expect(token(`--color-series-${String(index + 1)}`)).not.toBe("");
    });
  });

  it("draws a legend for two or more series: a swatch in the series colour, the name in muted ink", async () => {
    const screen = await render(<Legend series={two} />);
    const legend = screen.getByRole("list", { name: "Legend" });
    const item = legend.getByRole("listitem").nth(1);
    await expect.element(item).toHaveTextContent("quadparts: TBS Source One V5");
    expect(styleOf(item).color).toBe(rgb(token("--color-ink-muted")));
    const swatch = item.element().querySelector("[aria-hidden='true']");
    expect(swatch === null ? "" : getComputedStyle(swatch).backgroundColor).toBe(rgb(token("--color-series-2")));
  });

  it("draws no legend for a single series, which its title names", async () => {
    const screen = await render(<Legend series={two.slice(0, 1)} />);
    await expect.element(screen.getByRole("list")).not.toBeInTheDocument();
  });

  it("dresses a line chart: horizontal grid, axis, 2px lines with gaps and ringed lone dots", async () => {
    const data = VALUES.map((value, day) => ({ day, value }));
    const screen = await render(
      <LineChart width={WIDTH} height={HEIGHT} data={data}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="day" {...axisProps} />
        <YAxis {...axisProps} />
        <Line dataKey="value" {...lineProps(VALUES, SERIES[0], "test-dot")} />
      </LineChart>,
    );
    const { container } = screen;
    expect(container.querySelectorAll(".recharts-cartesian-grid-vertical line")).toHaveLength(0);
    const curve = container.querySelector(".recharts-line-curve");
    expect(curve?.getAttribute("stroke-width")).toBe("2");
    const dot = container.querySelector(".test-dot");
    expect(dot?.getAttribute("stroke")).toBe("var(--color-surface)");
    expect(container.querySelectorAll(".test-dot")).toHaveLength(1);
    const tick = container.querySelector(".recharts-cartesian-axis-tick-value");
    const tickStyle = tick === null ? null : getComputedStyle(tick);
    expect(tickStyle?.fontFamily).toContain("Martian Mono");
    expect(tickStyle?.fontSize).toBe("11px");
    expect(tickStyle?.fontStretch).toBe("87.5%");
    expect(tickStyle?.fontVariantNumeric).toBe("tabular-nums slashed-zero");
  });

  it("marks the hovered day with a dashed crosshair in the strong line colour", async () => {
    const data = VALUES.map((value, day) => ({ day, value }));
    const screen = await render(
      <LineChart width={WIDTH} height={HEIGHT} data={data}>
        <XAxis dataKey="day" {...axisProps} />
        <Tooltip cursor={cursorProps} content={() => null} isAnimationActive={false} />
        <Line dataKey="value" {...lineProps(VALUES, SERIES[0], "test-dot")} />
      </LineChart>,
    );
    await userEvent.hover(screen.container.querySelector(".recharts-surface") ?? screen.container);
    await expect.poll(() => screen.container.querySelector(".recharts-tooltip-cursor")).not.toBeNull();
    const cursor = screen.container.querySelector(".recharts-tooltip-cursor");
    expect(cursor?.getAttribute("stroke")).toBe("var(--color-line-strong)");
    expect(cursor?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("frames a tooltip on the raised surface, in the small type", async () => {
    const screen = await render(<ChartTooltip><p>€41.54</p></ChartTooltip>);
    const frame = screen.getByText("€41.54").element().parentElement;
    const style = frame === null ? null : getComputedStyle(frame);
    expect(style?.backgroundColor).toBe(rgb(token("--color-surface-raised")));
    expect(style?.fontSize).toBe("12px");
  });
});
