import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AddProduct } from "./add-product.tsx";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { ScanNow } from "./scan-now.tsx";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { DataTable } from "./ui/data-table.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { LINK } from "./ui/link.ts";
import { Price } from "./ui/price.tsx";
import { Sparkline } from "./ui/sparkline.tsx";

const EMPTY = "Nothing is watched yet. Paste a store URL above to start.";

/**
 * The watchlist screen: the add-by-URL form, then every watched product with its cheapest landed cost, its price
 * trend and its unread alert count.
 *
 * @returns The screen.
 */
export const Watchlist = () => {
  const client = useClient();
  const rows = useQuery({
    queryKey: QueryKey.Watchlist,
    queryFn: async () => client.listProducts(),
    throwOnError: true,
  }).data;
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="type-title">Watchlist</h1>
        <ScanNow />
      </div>
      <AddProduct />
      <div className="mt-8">
        {rows === undefined && <p className="text-ink-muted type-body">Loading…</p>}
        {rows?.length === 0 && <EmptyState tag={EmptyTag.NoSignal}>{EMPTY}</EmptyState>}
        {rows !== undefined && rows.length > 0 && (
          <DataTable
            caption="Watched products"
            rows={rows}
            rowKey={({ product }) => product.id}
            rowHeader={{
              header: "Product",
              cell: ({ product }) => (
                <Link to="/products/$id" params={{ id: product.id }} className={LINK}>{product.name}</Link>
              ),
            }}
            columns={[
              {
                header: "Cheapest landed",
                numeric: true,
                cell: ({ cheapest }) => <Price money={cheapest?.landedCost ?? null} />,
              },
              { header: "Last 30 days", cell: ({ trend }) => <Sparkline trend={trend} /> },
              {
                header: "Alerts",
                cell: ({ unreadAlerts }) => unreadAlerts > 0 && (
                  <Badge tone={BadgeTone.Live}>{unreadAlerts} unread</Badge>
                ),
              },
            ]}
          />
        )}
      </div>
    </section>
  );
};
