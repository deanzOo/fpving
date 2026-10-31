import type { Money } from "@fpving/plugin-sdk";
import { useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DotItemDotProps, TooltipContentProps } from "recharts";
import type { Client } from "./client.ts";
import { formatMoney } from "./money.ts";

type Listings = Awaited<ReturnType<Client["getProduct"]>>["listings"];

const DAY_MS = 86_400_000;
const HEIGHT = 280;
const STROKE = 2;
const DOT_RADIUS = 4;
const AXIS_WIDTH = 88;
const MARGIN = { top: 8, right: 16, bottom: 8, left: 8 } as const;
const SERIES_COLORS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
] as const;
const DAY = "day";

const dayOf = (at: Date): number => Math.floor(at.getTime() / DAY_MS);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const dateOf = (day: number): string => dateFormat.format(new Date(day * DAY_MS));

/**
 * The landed cost of each listing once a day, one line per listing in a fixed series colour, from the first day with
 * a snapshot to today; a day's value is that day's last snapshot. A day without a landed cost leaves a gap and a
 * priced day with no priced neighbour is a dot. The chart's name sums each listing's range up, and hovering, or
 * focusing it and pressing the arrow keys, shows every listing's cost that day. The palette has eight series, so a
 * ninth listing and after are left to the table.
 *
 * @param props - The listings with their priced histories.
 * @returns The chart, or a note when nothing has a landed cost.
 */
export const PriceHistory = ({ listings }: { readonly listings: Listings }) => {
  const headingId = useId();
  const charted = SERIES_COLORS.flatMap((color, index) => {
    const entry = listings[index];
    return entry === undefined ? [] : [{ ...entry, color }];
  });
  const priced = charted.flatMap(({ history }) => history.flatMap(({ landedCost }) => landedCost ?? []));
  const [first] = priced;
  const heading = <h2 id={headingId} className="text-xl font-semibold">Price history</h2>;
  if (first === undefined) {
    return (
      <section className="mt-8">
        {heading}
        <p className="mt-2 text-ink-muted">No landed cost to chart yet.</p>
      </section>
    );
  }
  const money = (amountMinor: number): string => formatMoney({ amountMinor, currency: first.currency });
  const start = Math.min(...charted.flatMap(({ history }) => history.map(({ observedAt }) => dayOf(observedAt))));
  const days = Array.from({ length: dayOf(new Date()) - start + 1 }, (_, index) => start + index);
  const series = charted.map(({ listing, history, color }) => {
    const byDay = new Map(history.map(({ observedAt, landedCost }) => [dayOf(observedAt), landedCost]));
    const values = days.map((day): Money | null => byDay.get(day) ?? null);
    return { key: listing.id, name: listing.pluginId, color, values };
  });
  const rows = days.map((day, index) => {
    const cells: [string, number | null][] = series.map(({ key, values }) => [key, values[index]?.amountMinor ?? null]);
    return Object.fromEntries([[DAY, day], ...cells]);
  });
  const summary = series.map(({ name, values }) => {
    const amounts = values.flatMap((value) => (value === null ? [] : [value.amountMinor]));
    const latest = amounts.at(-1);
    return latest === undefined
      ? `${name} no price`
      : `${name} lowest ${money(Math.min(...amounts))}, highest ${money(Math.max(...amounts))}, `
        + `latest ${money(latest)}`;
  }).join("; ");
  const name = `Landed cost over the last ${String(days.length)} days: ${summary}`;
  const TooltipBody = ({ active, label }: TooltipContentProps) => {
    if (!active) {
      return null;
    }
    const index = Number(label) - start;
    return (
      <div className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink">
        <p className="font-medium">{dateOf(Number(label))}</p>
        {series.map(({ key, name: listingName, color, values }) => {
          const value = values[index] ?? null;
          return (
            <p key={key} className="flex items-center gap-2 whitespace-nowrap">
              <span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ backgroundColor: color }} />
              {`${listingName} ${value === null ? "No price" : formatMoney(value)}`}
            </p>
          );
        })}
      </div>
    );
  };
  return (
    <section className="mt-8">
      {heading}
      <figure aria-labelledby={headingId} className="mt-4">
        {listings.length > charted.length && (
          <p className="mb-2 text-sm text-ink-muted">
            The chart shows the first {charted.length} of {listings.length} listings; the table lists them all.
          </p>
        )}
        <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-4 text-sm text-ink-muted">
          {series.map(({ key, name: listingName, color }) => (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-0.5 w-4" style={{ backgroundColor: color }} />
              {listingName}
            </li>
          ))}
        </ul>
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={rows} title={name} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey={DAY}
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={dateOf}
              stroke="var(--color-line)"
              tick={{ fill: "var(--color-ink-muted)" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={money}
              width={AXIS_WIDTH}
              stroke="var(--color-line)"
              tick={{ fill: "var(--color-ink-muted)" }}
            />
            <Tooltip content={TooltipBody} filterNull={false} isAnimationActive={false} />
            {series.map(({ key, color, values }) => {
              const hasPrice = (day: number): boolean => (values[day] ?? null) !== null;
              const LoneDot = ({ cx, cy, index }: DotItemDotProps) =>
                hasPrice(index) && !hasPrice(index - 1) && !hasPrice(index + 1)
                  ? (
                      <circle
                        key={index}
                        className="history-dot"
                        cx={cx}
                        cy={cy}
                        r={DOT_RADIUS}
                        fill={color}
                        stroke="var(--color-surface)"
                        strokeWidth={STROKE}
                      />
                    )
                  : null;
              return (
                <Line
                  key={key}
                  dataKey={key}
                  stroke={color}
                  strokeWidth={STROKE}
                  dot={LoneDot}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </figure>
    </section>
  );
};
