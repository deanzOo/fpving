import { AlertKind } from "@fpving/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toFailure, useClient } from "./client.ts";
import { useFocusAfterRemoval } from "./focus.ts";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";
import { fromNow } from "./time.ts";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { Button, ButtonSize } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { LINK } from "./ui/link.ts";
import { Notice, NoticeTone } from "./ui/notice.tsx";

const KIND = {
  [AlertKind.PriceDrop]: { label: "Price drop", tone: BadgeTone.Good, glyph: "▼" },
  [AlertKind.BackInStock]: { label: "Back in stock", tone: BadgeTone.Info, glyph: "✓" },
  [AlertKind.NewCheapest]: { label: "New cheapest listing", tone: BadgeTone.Good, glyph: "★" },
} as const;

const GONE = "a product no longer watched";
const MARKING = "Marking…";

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
      <h1 ref={heading} tabIndex={-1} className="type-title">Alerts</h1>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Checkbox
          label="Unread only"
          checked={unreadOnly}
          onChange={(event) => {
            setUnreadOnly(event.target.checked);
          }}
        />
        <Button
          pending={markAll.isPending}
          pendingLabel={MARKING}
          onClick={() => {
            markAll.mutate();
          }}
        >
          Mark all read
        </Button>
        <p role="status" className="text-ink-muted type-small">
          {markAll.isSuccess ? `Marked ${String(markAll.data.marked)} alerts read.` : ""}
        </p>
      </div>
      {failed !== null && (
        <div className="mt-4">
          <Notice tone={NoticeTone.Critical}>{explain(toFailure(failed))}</Notice>
        </div>
      )}
      <div className="mt-6">
        {alerts === undefined && <p className="text-ink-muted type-body">Loading…</p>}
        {alerts?.length === 0 && (
          <EmptyState tag={EmptyTag.Clear}>{unreadOnly ? "No unread alerts." : "No alerts yet."}</EmptyState>
        )}
        <ul ref={list} className="flex flex-col">
          {alerts?.map((alert, index) => {
            const name = names.get(alert.productId);
            const when = fromNow(alert.createdAt);
            const { label, tone, glyph } = KIND[alert.kind];
            return (
              <li
                key={alert.id}
                tabIndex={-1}
                className="flex min-h-(--row-height) flex-wrap items-center gap-3 border-b border-line py-2"
              >
                <Badge tone={tone} glyph={glyph}>{label}</Badge>
                {name === undefined
                  ? <span className="text-ink-muted type-body">{GONE}</span>
                  : (
                      <Link to="/products/$id" params={{ id: alert.productId }} className={`type-body ${LINK}`}>
                        {name}
                      </Link>
                    )}
                <span className="text-ink-muted type-small">{when}</span>
                {alert.readAt === null
                  ? <Badge tone={BadgeTone.Live}>Unread</Badge>
                  : <span className="text-ink-muted type-small">Read</span>}
                {alert.readAt === null && (
                  <span className="ml-auto">
                    <Button
                      size={ButtonSize.Small}
                      pending={markOne.isPending}
                      pendingLabel={markOne.variables?.alertId === alert.id ? MARKING : undefined}
                      aria-label={`Mark read: ${label} on ${name ?? GONE}, ${when}`}
                      onClick={() => {
                        markOne.mutate({ alertId: alert.id, index });
                      }}
                    >
                      Mark read
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
