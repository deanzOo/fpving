import type { Money } from "@fpving/plugin-sdk";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { loneDot } from "./lone-dot.tsx";
import { formatMoney } from "./money.ts";

const WIDTH = 128;
const HEIGHT = 32;
const STROKE = 2;
const INSET = 3;
const DAY = "day";
const MARGIN = { top: INSET, right: INSET, bottom: INSET, left: INSET } as const;

const relativeDay = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/**
 * A product's cheapest price once a day, oldest first, as a 2px line with no axes. A day without a price leaves a
 * gap instead of a bridged segment, and a price with no priced day beside it is a dot. The figure's name sums the
 * range up; hovering, or focusing it and pressing the arrow keys, shows each day's price.
 *
 * @param props - The trend, one entry a day, null on a day without a price.
 * @returns The sparkline, or a note when no day has a price.
 */
export const Sparkline = ({ trend }: { readonly trend: readonly (Money | null)[] }) => {
  const priced = trend.filter((price) => price !== null);
  const latest = priced.at(-1);
  if (latest === undefined) {
    return <span className="text-sm text-ink-muted">No prices in the last {trend.length} days</span>;
  }
  const amounts = priced.map(({ amountMinor }) => amountMinor);
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: latest.currency });
  const name = `Last ${String(trend.length)} days: lowest ${money(Math.min(...amounts))}, highest `
    + `${money(Math.max(...amounts))}, latest ${formatMoney(latest)}, ${String(priced.length)} days with a price`;
  const data = trend.map((price, day) => ({ day, amountMinor: price?.amountMinor ?? null }));
  const today = trend.length - 1;
  const TooltipBody = ({ active, label }: TooltipContentProps) => {
    if (!active) {
      return null;
    }
    const day = Number(label);
    const price = trend[day];
    const shown = price ? formatMoney(price) : "No price";
    return (
      <p className="whitespace-nowrap rounded border border-line bg-surface px-2 py-1 text-sm text-ink">
        {shown}, {relativeDay.format(day - today, "day")}
      </p>
    );
  };
  return (
    <div className="text-series-1">
      <LineChart width={WIDTH} height={HEIGHT} data={data} title={name} margin={MARGIN}>
        <XAxis dataKey={DAY} hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip
          content={TooltipBody}
          cursor={false}
          filterNull={false}
          isAnimationActive={false}
          allowEscapeViewBox={{ x: true, y: true }}
          position={{ y: 0 }}
        />
        <Line
          dataKey="amountMinor"
          stroke="currentColor"
          strokeWidth={STROKE}
          dot={loneDot(trend, { className: "sparkline-dot", fill: "currentColor" })}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
};
