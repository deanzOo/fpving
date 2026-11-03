import type { Money } from "@fpving/plugin-sdk";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { ChartTooltip, lineProps, SERIES } from "./chart-theme.tsx";
import { formatMoney } from "../money.ts";

const WIDTH = 128;
const HEIGHT = 32;
const INSET = 3;
const DAY = "day";
const [SPARK] = SERIES;
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
    return <span className="text-ink-muted type-small">No prices in the last {trend.length} days</span>;
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
    return (
      <ChartTooltip>
        <p>
          {price ? <span className="type-readout">{formatMoney(price)}</span> : "No price"}
          {`, ${relativeDay.format(day - today, "day")}`}
        </p>
      </ChartTooltip>
    );
  };
  return (
    <div>
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
          {...lineProps(trend, SPARK, "sparkline-dot")}
        />
      </LineChart>
    </div>
  );
};
