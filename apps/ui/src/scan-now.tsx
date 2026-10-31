import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toFailure, useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";
import { fromNow } from "./time.ts";

const POLL_MS = 1000;

/**
 * The scan now control and the scan status: running, or when the last scan finished with how many listings it
 * fetched, how many failed and how many alerts it raised. While a scan runs the status is polled, and once it
 * finishes the watchlist and the alerts are read again.
 *
 * @returns The control.
 */
export const ScanNow = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: QueryKey.Scan,
    queryFn: async () => client.getScan(),
    refetchInterval: (query) => (query.state.data?.running === true ? POLL_MS : false),
  }).data;
  const started = useMutation({
    mutationFn: async () => client.startScan(),
    onSuccess: (next) => {
      queryClient.setQueryData(QueryKey.Scan, next);
    },
  });
  const finishedAt = status?.lastResult?.finishedAt.getTime();
  useEffect(() => {
    if (finishedAt !== undefined) {
      void queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist });
      void queryClient.invalidateQueries({ queryKey: QueryKey.Alerts });
    }
  }, [finishedAt, queryClient]);
  const last = status?.lastResult;
  const said = status?.running === true
    ? "Scanning every listing…"
    : last === null || last === undefined
      ? "No scan has finished since fpving started."
      : `Last scan finished ${fromNow(last.finishedAt)}: `
        + `${String(last.plugins.reduce((sum, { succeeded }) => sum + succeeded, 0))} listings fetched, `
        + `${String(last.plugins.reduce((sum, { failed }) => sum + failed, 0))} failed, ${String(last.alerts)} alerts`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm text-ink-muted">{status === undefined ? "" : said}</p>
      <button
        type="button"
        disabled={started.isPending || status?.running === true}
        onClick={() => {
          started.mutate();
        }}
        className="rounded-md border border-line px-4 py-2 font-medium disabled:opacity-60"
      >
        Scan now
      </button>
      {started.isError && <p role="alert" className="w-full text-critical">{explain(toFailure(started.error))}</p>}
    </div>
  );
};
