import type { Money } from "@fpving/plugin-sdk";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
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
 * gap instead of a bridged segment. The figure's name sums the range up; hovering shows the day's price.
 *
 * @param props - The trend, one entry a day, null on a day without a price.
 * @returns The sparkline, or a note when no day has a price.
 */
export const Sparkline = ({ trend }: { readonly trend: readonly (Money | null)[] }) => {
  const priced = trend.filter((price) => price !== null);
  const [first] = priced;
  if (first === undefined) {
    return <span className="text-sm text-ink-muted">No prices in the last {trend.length} days</span>;
  }
  const amounts = priced.map(({ amountMinor }) => amountMinor);
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: first.currency });
  const latest = priced.reduce((_earlier, price) => price, first);
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
      <p className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink">
        {shown}, {relativeDay.format(day - today, "day")}
      </p>
    );
  };
  return (
    <div role="img" aria-label={name} className="text-series">
      <LineChart width={WIDTH} height={HEIGHT} data={data} accessibilityLayer={false} margin={MARGIN}>
        <XAxis dataKey={DAY} hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip content={TooltipBody} cursor={false} filterNull={false} isAnimationActive={false} />
        <Line
          dataKey="amountMinor"
          stroke="currentColor"
          strokeWidth={STROKE}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
};
