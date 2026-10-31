import { useQuery } from "@tanstack/react-query";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";

/**
 * The watchlist screen.
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
      <h1 className="text-2xl font-semibold">Watchlist</h1>
      {rows?.length === 0 && <p className="mt-6 text-ink-muted">Nothing is watched yet.</p>}
    </section>
  );
};
