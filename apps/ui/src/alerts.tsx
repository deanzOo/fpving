import { AlertKind } from "@fpving/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toFailure, useClient } from "./client.ts";
import { useFocusAfterRemoval } from "./focus.ts";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";
import { fromNow } from "./time.ts";
import { unlessPending } from "./pending.ts";

const KIND_LABEL = {
  [AlertKind.PriceDrop]: "Price drop",
  [AlertKind.BackInStock]: "Back in stock",
  [AlertKind.NewCheapest]: "New cheapest listing",
} as const;

const GONE = "a product no longer watched";
const item = "flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2";
const button = "rounded-md border border-line px-3 py-1 font-medium aria-disabled:opacity-60";

/**
 * The alerts screen: every alert newest first, or only the unread ones, each with its product, and marking one or
 * all of them read, which also updates the unread count in the navigation.
 *
 * @returns The screen.
 */
export const Alerts = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const alerts = useQuery({
    queryKey: unreadOnly ? QueryKey.UnreadAlerts : QueryKey.AllAlerts,
    queryFn: async () => client.listAlerts({ unread: unreadOnly ? "true" : undefined }),
    throwOnError: true,
  }).data;
  const names = new Map(useQuery({
    queryKey: QueryKey.Watchlist,
    queryFn: async () => client.listProducts(),
    throwOnError: true,
  }).data?.map(({ product }) => [product.id, product.name]));
  const changed = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: QueryKey.Alerts }),
    queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist }),
  ]);
  const { list, heading, track } = useFocusAfterRemoval(
    (alertId) => alerts?.some(({ id, readAt }) => id === alertId && readAt === null) === true,
  );
  const markOne = useMutation({
    mutationFn: async ({ alertId }: { readonly alertId: string; readonly index: number }) =>
      client.markAlertRead({ alertId }),
    onMutate: ({ alertId, index }) => {
      track({ id: alertId, index });
    },
    onError: () => {
      track(null);
    },
    onSuccess: changed,
  });
  const markAll = useMutation({ mutationFn: client.markAllAlertsRead, onSuccess: changed });
  const failed = markOne.error ?? markAll.error;
  return (
    <section>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">Alerts</h1>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
            }}
          />
          Unread only
        </label>
        <button
          type="button"
          className={button}
          aria-disabled={markAll.isPending}
          onClick={unlessPending(markAll.isPending, () => {
            markAll.mutate();
          })}
        >
          Mark all read
        </button>
        <p role="status" className="text-ink-muted">
          {markAll.isSuccess ? `Marked ${String(markAll.data.marked)} alerts read.` : ""}
        </p>
      </div>
      {failed !== null && <p role="alert" className="mt-4 text-critical">{explain(toFailure(failed))}</p>}
      {alerts === undefined && <p className="mt-6 text-ink-muted">Loading…</p>}
      {alerts?.length === 0 && (
        <p className="mt-6 text-ink-muted">{unreadOnly ? "No unread alerts." : "No alerts yet."}</p>
      )}
      <ul ref={list} className="mt-6 flex flex-col gap-2">
        {alerts?.map((alert, index) => {
          const name = names.get(alert.productId);
          const when = fromNow(alert.createdAt);
          return (
            <li key={alert.id} tabIndex={-1} className={item}>
              <span className="font-medium">{KIND_LABEL[alert.kind]}</span>
              {name === undefined
                ? <span className="text-ink-muted">{GONE}</span>
                : <Link to="/products/$id" params={{ id: alert.productId }} className="underline">{name}</Link>}
              <span className="text-sm text-ink-muted">{when}</span>
              <span className="text-sm">{alert.readAt === null ? "Unread" : "Read"}</span>
              {alert.readAt === null && (
                <button
                  type="button"
                  className={button}
                  aria-disabled={markOne.isPending}
                  aria-label={`Mark read: ${KIND_LABEL[alert.kind]} on ${name ?? GONE}, ${when}`}
                  onClick={unlessPending(markOne.isPending, () => {
                    markOne.mutate({ alertId: alert.id, index });
                  })}
                >
                  Mark read
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
