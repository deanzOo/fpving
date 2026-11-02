import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AddProduct } from "./add-product.tsx";
import { useClient } from "./client.ts";
import { formatMoney } from "./money.ts";
import { QueryKey } from "./queries.ts";
import { ScanNow } from "./scan-now.tsx";
import { Sparkline } from "./sparkline.tsx";

const cell = "border-b border-line px-3 py-2";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <ScanNow />
      </div>
      <AddProduct />
      {rows === undefined && <p className="mt-6 text-ink-muted">Loading…</p>}
      {rows?.length === 0 && <p className="mt-6 text-ink-muted">{EMPTY}</p>}
      {rows !== undefined && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Watched products</caption>
            <thead>
              <tr className="text-sm text-ink-muted">
                <th scope="col" className={cell}>Product</th>
                <th scope="col" className={cell}>Cheapest landed</th>
                <th scope="col" className={cell}>Last 30 days</th>
                <th scope="col" className={cell}>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, cheapest, trend, unreadAlerts }) => (
                <tr key={product.id}>
                  <th scope="row" className={`${cell} font-medium`}>
                    <Link to="/products/$id" params={{ id: product.id }} className="hover:underline">
                      {product.name}
                    </Link>
                  </th>
                  <td className={`${cell} tabular-nums`}>
                    {cheapest === null
                      ? <span className="text-ink-muted">No price yet</span>
                      : formatMoney(cheapest.landedCost)}
                  </td>
                  <td className={cell}><Sparkline trend={trend} /></td>
                  <td className={cell}>
                    {unreadAlerts > 0 && (
                      <span className="whitespace-nowrap rounded-full bg-signal px-2 text-sm text-on-signal">
                        {unreadAlerts} unread
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
