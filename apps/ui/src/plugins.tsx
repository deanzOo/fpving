import { apiRoutes } from "@fpving/app/api-routes";
import { HttpStatus } from "@fpving/app/http-status";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { fromNow } from "./time.ts";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { DataTable } from "./ui/data-table.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";

type Row = z.output<(typeof apiRoutes.listPlugins.schema.response)[typeof HttpStatus.Ok]>[number];

const rowSchema = apiRoutes.listPlugins.schema.response[HttpStatus.Ok].element.shape;
const { Loaded } = rowSchema.status.enum;
const { ConfigInvalid } = rowSchema.issues.element.shape.kind.enum;

const Trouble = {
  Failed: { tone: BadgeTone.Critical, glyph: "✕" },
  Warned: { tone: BadgeTone.Warning, glyph: "▲" },
  BackingOff: { tone: BadgeTone.Warning, glyph: "↻" },
} as const;

const Kinded = ({ kind, detail }: { readonly kind: string; readonly detail: string }) => (
  <>
    <code className="type-code">{kind}</code>
    {`: ${detail}`}
  </>
);

const troubles = ({ status, issues, backoffUntil }: Row) => [
  ...issues.map(({ kind, detail }) => {
    if (kind === ConfigInvalid) {
      return { word: "Config invalid", look: Trouble.Failed, joint: ": ", said: `plugins.json is unusable: ${detail}` };
    }
    return {
      word: status === Loaded ? "Warning" : "Disabled",
      look: status === Loaded ? Trouble.Warned : Trouble.Failed,
      joint: ": ",
      said: <Kinded kind={kind} detail={detail} />,
    };
  }),
  ...(backoffUntil === null
    ? []
    : [{ word: "Backing off", look: Trouble.BackingOff, joint: ", ", said: `retrying ${fromNow(backoffUntil)}` }]),
];

const State = ({ row }: { readonly row: Row }) => (
  <div className="flex flex-col items-start gap-1">
    {row.status === Loaded ? <Badge tone={BadgeTone.Live}>Loaded</Badge> : null}
    {troubles(row).map(({ word, look, joint, said }, index) => (
      <p key={index} className="flex flex-wrap items-center gap-2 type-small">
        <Badge {...look}>{word}</Badge>
        <span className="sr-only">{joint}</span>
        <span>{said}</span>
      </p>
    ))}
  </div>
);

const WarnedCount = ({ count }: { readonly count: number }) => count === 0
  ? count
  : (
      <span className="text-warning">
        <span aria-hidden="true">▲ </span>
        <span>{count}</span>
      </span>
    );

/**
 * The plugins screen: one row per `plugins.json` entry, rejected entry or unusable file, with the plugin's name and
 * id, its state, the domains it declares and how many of its listings are stale or not being scanned.
 *
 * @returns The screen.
 */
export const Plugins = () => {
  const client = useClient();
  const rows = useQuery({
    queryKey: QueryKey.Plugins,
    queryFn: async () => client.listPlugins(),
    throwOnError: true,
  }).data;
  return (
    <section>
      <h1 className="type-title">Plugins</h1>
      <div className="mt-6">
        {rows === undefined && <p className="text-ink-muted type-body">Loading…</p>}
        {rows?.length === 0 && (
          <EmptyState tag={EmptyTag.NoSignal}>
            No plugin is listed in plugins.json. List one, then restart fpving.
          </EmptyState>
        )}
        {rows !== undefined && rows.length > 0 && (
          <DataTable
            caption="Plugins"
            rows={rows}
            rowKey={({ source }) => source}
            rowHeader={{
              header: "Plugin",
              cell: ({ source, manifest }) => (manifest === null
                ? <code className="type-code">{source}</code>
                : (
                    <>
                      {manifest.displayName} <code className="text-ink-muted type-code">{manifest.id}</code>
                    </>
                  )),
            }}
            columns={[
              { header: "State", cell: (row) => <State row={row} /> },
              {
                header: "Domains",
                cell: ({ manifest }) => (manifest !== null && "kind" in manifest
                  ? <span className="type-body">Catalog</span>
                  : <span className="type-code">{manifest?.domains.join(", ") ?? ""}</span>),
              },
              {
                header: "Stale listings",
                numeric: true,
                cell: ({ staleListings }) => <WarnedCount count={staleListings} />,
              },
              {
                header: "Not scanned",
                numeric: true,
                cell: ({ unscannedListings }) => <WarnedCount count={unscannedListings} />,
              },
            ]}
          />
        )}
      </div>
    </section>
  );
};
