import type { ReactNode } from "react";
import { loneDot } from "./lone-dot.tsx";

/** The chart series colours, assigned in this order to the charted listings and never cycled. */
export const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
] as const;

const STROKE = 2;
const LEGEND_FROM = 2;
const SURFACE = "var(--color-surface)";

/** Recharts grid props: horizontal gridlines only, in the grid token. */
export const gridProps = { vertical: false, stroke: "var(--color-chart-grid)" } as const;

/** Recharts axis props: the axis and ticks in the axis token, tick labels as muted mono readouts. */
export const axisProps = {
  stroke: "var(--color-chart-axis)",
  tick: {
    fill: "var(--color-ink-muted)",
    className: "chart-tick",
  },
} as const;

/** Recharts money axis props: the same tick labels, with no axis line or tick marks. */
export const moneyAxisProps = { ...axisProps, axisLine: false, tickLine: false } as const;

/** Recharts tooltip cursor: a dashed crosshair at the hovered day, in the strong line colour. */
export const cursorProps = { stroke: "var(--color-line-strong)", strokeDasharray: "2 3" } as const;

/**
 * Recharts line props for one series: a 2px line in its colour that leaves gaps, and a 4px dot ringed in the surface
 * for a priced day with no priced neighbour.
 *
 * @param values - The series' values, null where it has none.
 * @param color - The series colour.
 * @param dotClass - The lone dots' class.
 * @returns The props.
 */
export const lineProps = (values: readonly unknown[], color: string, dotClass: string) => ({
  stroke: color,
  strokeWidth: STROKE,
  strokeLinejoin: "round",
  dot: loneDot(values, { className: dotClass, fill: color, ring: { stroke: SURFACE, width: STROKE } }),
  connectNulls: false,
  isAnimationActive: false,
} as const);

/**
 * A series' 16 × 2 swatch, beside its name in a legend or a tooltip line.
 *
 * @param props - The series colour.
 * @returns The swatch.
 */
export const Swatch = ({ color }: { readonly color: string }) => (
  <span aria-hidden="true" className="inline-block h-0.5 w-4 flex-none" style={{ backgroundColor: color }} />
);

/**
 * The legend for two or more series, above the plot: a swatch and the name in muted ink, never in the series colour.
 * A single series has none, as the chart's title names it, unless `single` asks for one because the title does not.
 *
 * @param props - The series, and whether a single series gets a legend.
 * @returns The legend, or nothing for fewer than two series unless `single`.
 */
export const Legend = ({ series, single = false }: {
  readonly series: readonly { readonly key: string; readonly name: string; readonly color: string }[];
  readonly single?: boolean;
}) => series.length < (single ? 1 : LEGEND_FROM)
  ? null
  : (
      <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-4 text-ink-muted type-small">
        {series.map(({ key, name, color }) => (
          <li key={key} className="flex items-center gap-2">
            <Swatch color={color} />
            {name}
          </li>
        ))}
      </ul>
    );

/**
 * The frame of a chart tooltip: the raised surface on a strong hairline, in the small type, with an optional title
 * such as the date above the lines.
 *
 * @param props - The title and the tooltip lines.
 * @returns The frame.
 */
export const ChartTooltip = ({ title, children }: { readonly title?: string; readonly children: ReactNode }) => (
  <div
    className="whitespace-nowrap rounded-2 border border-line-strong bg-surface-raised px-2 py-1 text-ink type-small"
  >
    {title === undefined ? null : <p className="font-medium">{title}</p>}
    {children}
  </div>
);
