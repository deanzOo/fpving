import { ListingStatus } from "@fpving/core";
import type { Money } from "@fpving/plugin-sdk";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { Client } from "./client.ts";
import { listingName } from "./listing-name.ts";
import { formatMoney } from "./money.ts";
import {
  axisProps, ChartTooltip, cursorProps, gridProps, Legend, lineProps, moneyAxisProps, SERIES, Swatch,
} from "./ui/chart-theme.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { Panel } from "./ui/panel.tsx";

type Listings = Awaited<ReturnType<Client["getProduct"]>>["listings"];

const HEIGHT = 280;
const AXIS_WIDTH = 88;
const MARGIN = { top: 8, right: 24, bottom: 8, left: 8 } as const;
const DAY = "day";
const TITLE = "Price history";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const tickFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const midnight = (at: Date, offset = 0): Date => new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset);

/**
 * The landed cost of each listing once a day, one line per listing in a fixed series colour, from the first day with
 * a price to today. Days are the viewer's local calendar days, and a day's value is the listing's latest snapshot by
 * the end of that day, carried forward until the next snapshot; a listing that is no longer active is not carried past
 * the day of its last snapshot. A day without a landed cost leaves a gap and a
 * priced day with no priced neighbour is a dot. The chart's name sums each listing's range up, and hovering, or
 * focusing it and pressing the arrow keys, shows every listing's cost that day. Only listings with a landed cost are
 * charted, and the palette has eight series, so at most the eight most recently priced are; a note counts the others,
 * which the table still lists.
 *
 * @param props - The listings with their priced histories.
 * @returns The chart, or a note when nothing has a landed cost.
 */
export const PriceHistory = ({ listings }: { readonly listings: Listings }) => {
  const firstSeen = Math.min(
    ...listings.flatMap(({ history }) => history.map(({ observedAt }) => observedAt.getTime())),
  );
  const today = midnight(new Date()).getTime();
  const allDays: Date[] = [];
  for (let day = midnight(new Date(firstSeen)); day.getTime() <= today; day = midnight(day, 1)) {
    allDays.push(day);
  }
  const pricedListings = listings.flatMap(({ listing, history }) => {
    const lastSeen = history.reduce((_older, snapshot) => snapshot).observedAt;
    const values = allDays.map((day): Money | null => {
      const end = midnight(day, 1);
      const carried = listing.status === ListingStatus.Active || day <= lastSeen;
      return carried ? history.findLast(({ observedAt }) => observedAt < end)?.landedCost ?? null : null;
    });
    const costs = values.flatMap((cost, day) => (cost === null ? [] : [{ day, cost }]));
    const last = costs.at(-1);
    return last === undefined ? [] : [{ listing, values, costs, last }];
  });
  const recent = new Set([...pricedListings].sort((a, b) => b.last.day - a.last.day).slice(0, SERIES.length));
  const charted = SERIES.flatMap((color, index) => {
    const entry = pricedListings.filter((candidate) => recent.has(candidate))[index];
    return entry === undefined ? [] : [{ ...entry, color }];
  });
  const notCharted = listings.length - charted.length;
  const [first] = charted;
  if (first === undefined) {
    return (
      <div className="mt-8">
        <Panel title={TITLE}>
          <EmptyState tag={EmptyTag.NoData}>No landed cost to chart yet.</EmptyState>
        </Panel>
      </div>
    );
  }
  const money = (amountMinor: number): string => formatMoney({ amountMinor, currency: first.last.cost.currency });
  const start = Math.min(...charted.flatMap(({ costs }) => costs.map(({ day }) => day)));
  const days = allDays.slice(start);
  const series = charted.map(({ listing, values, color }) => ({
    key: listing.id,
    name: listingName(listing),
    color,
    values: values.slice(start),
  }));
  const dateOf = (index: number): string => dateFormat.format(days[index]);
  const rows = days.map((_day, index) => {
    const cells: [string, number | null][] = series.map(({ key, values }) => [key, values[index]?.amountMinor ?? null]);
    return Object.fromEntries([[DAY, index], ...cells]);
  });
  const summary = charted.map(({ listing, costs, last }) => {
    const amounts = costs.map(({ cost }) => cost.amountMinor);
    return `${listingName(listing)} lowest ${money(Math.min(...amounts))}, highest ${money(Math.max(...amounts))}, `
      + `latest ${money(last.cost.amountMinor)}`;
  }).join("; ");
  const name = `Landed cost over the last ${String(days.length)} days: ${summary}`;
  const TooltipBody = ({ active, label }: TooltipContentProps) => {
    if (!active) {
      return null;
    }
    const day = Number(label);
    return (
      <ChartTooltip>
        <p className="font-medium">{dateOf(day)}</p>
        {series.map(({ key, name: listingName, color, values }) => {
          const value = values[day] ?? null;
          return (
            <p key={key} className="flex items-center gap-2">
              <Swatch color={color} />
              {`${listingName} `}
              {value === null ? "No price" : <span className="type-readout">{formatMoney(value)}</span>}
            </p>
          );
        })}
      </ChartTooltip>
    );
  };
  return (
    <div className="mt-8">
      <Panel title={TITLE}>
        <figure aria-label={TITLE} className="m-0">
          {notCharted > 0 && (
            <p className="mb-2 text-ink-muted type-small">
              {`Not charted: ${String(notCharted)} ${notCharted === 1 ? "listing" : "listings"}. The chart shows up to `
                + `${String(SERIES.length)} listings with a landed cost, the most recently priced first; the `
                + "table lists them all."}
            </p>
          )}
          <Legend series={series} single />
          <ResponsiveContainer width="100%" height={HEIGHT}>
            <LineChart data={rows} title={name} margin={MARGIN}>
              <CartesianGrid {...gridProps} />
              <XAxis
                {...axisProps}
                dataKey={DAY}
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(index: number) => tickFormat.format(days[index])}
              />
              <YAxis {...moneyAxisProps} domain={["auto", "auto"]} tickFormatter={money} width={AXIS_WIDTH} />
              <Tooltip content={TooltipBody} cursor={cursorProps} filterNull={false} isAnimationActive={false} />
              {series.map(({ key, color, values }) => (
                <Line key={key} dataKey={key} {...lineProps(values, color, "history-dot")} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </figure>
      </Panel>
    </div>
  );
};
