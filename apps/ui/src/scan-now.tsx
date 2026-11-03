import { ApiErrorKind } from "@fpving/app/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toFailure, useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { fromNow } from "./time.ts";
import { ScanStatus } from "./ui/scan-status.tsx";

const POLL_MS = 1000;

const Figure = ({ children }: { readonly children: number }) => <span className="type-readout">{children}</span>;

/**
 * The scan now control and the scan status: running, or when the last scan finished with how many listings it
 * fetched, how many failed and how many alerts it raised. While a scan runs the status is polled, and when a scan
 * seen running finishes the watchlist and the alerts are read again. A refusal because a scan is already running
 * reads the status again, so that scan shows.
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
    onError: async (error) => {
      if (toFailure(error).kind === ApiErrorKind.ScanRunning) {
        await queryClient.invalidateQueries({ queryKey: QueryKey.Scan });
      }
    },
  });
  const running = status?.running === true;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist });
      void queryClient.invalidateQueries({ queryKey: QueryKey.Alerts });
    }
    wasRunning.current = running;
  }, [running, queryClient]);
  const last = status?.lastResult;
  const said = running
    ? "Scanning every listing…"
    : last === null || last === undefined
      ? "No scan has finished since fpving started."
      : (
          <>
            {`Last scan finished ${fromNow(last.finishedAt)}: `}
            <Figure>{last.plugins.reduce((sum, { succeeded }) => sum + succeeded, 0)}</Figure>
            {" listings fetched, "}
            <Figure>{last.plugins.reduce((sum, { failed }) => sum + failed, 0)}</Figure>
            {" failed, "}
            <Figure>{last.alerts}</Figure>
            {" alerts"}
          </>
        );
  return (
    <div className="flex flex-col items-end gap-2">
      <ScanStatus
        running={running}
        starting={started.isPending}
        onStart={() => {
          started.mutate();
        }}
      >
        {status === undefined ? "" : said}
      </ScanStatus>
      {started.isError && <Refused error={started.error} />}
    </div>
  );
};
