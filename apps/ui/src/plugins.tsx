import { apiRoutes } from "@fpving/app/api-routes";
import { HttpStatus } from "@fpving/app/http-status";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { fromNow } from "./time.ts";

type Row = z.output<(typeof apiRoutes.listPlugins.schema.response)[typeof HttpStatus.Ok]>[number];

const rowSchema = apiRoutes.listPlugins.schema.response[HttpStatus.Ok].element.shape;
const { Loaded } = rowSchema.status.enum;
const { ConfigInvalid } = rowSchema.issues.element.shape.kind.enum;
const cell = "border-b border-line px-3 py-2";

const state = ({ status, issues, backoffUntil }: Row): string[] => [
  ...(status === Loaded ? ["Loaded"] : []),
  ...issues.map(({ kind, detail }) => {
    if (kind === ConfigInvalid) {
      return `plugins.json is unusable: ${detail}`;
    }
    return status === Loaded ? `Warning (${kind}): ${detail}` : `Disabled (${kind}): ${detail}`;
  }),
  ...(backoffUntil === null ? [] : [`Backing off, retrying ${fromNow(backoffUntil)}`]),
];

/**
 * The plugins screen: one row per `plugins.json` entry, rejected entry or unusable file, with the plugin's name and
 * id, its state, the domains it declares and how many of its listings are stale.
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
      <h1 className="text-2xl font-semibold">Plugins</h1>
      {rows === undefined && <p className="mt-6 text-ink-muted">Loading…</p>}
      {rows?.length === 0 && (
        <p className="mt-6 text-ink-muted">No plugin is listed in plugins.json. List one, then restart fpving.</p>
      )}
      {rows !== undefined && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Plugins</caption>
            <thead>
              <tr className="text-sm text-ink-muted">
                <th scope="col" className={cell}>Plugin</th>
                <th scope="col" className={cell}>State</th>
                <th scope="col" className={cell}>Domains</th>
                <th scope="col" className={cell}>Stale listings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.source}>
                  <th scope="row" className={`${cell} font-medium`}>
                    {row.manifest === null
                      ? <code>{row.source}</code>
                      : (
                          <>
                            {row.manifest.displayName} <code className="text-sm text-ink-muted">{row.manifest.id}</code>
                          </>
                        )}
                  </th>
                  <td className={cell}>
                    {state(row).map((line) => <p key={line}>{line}</p>)}
                  </td>
                  <td className={cell}>{row.manifest?.domains.join(", ") ?? ""}</td>
                  <td className={`${cell} tabular-nums`}>{row.staleListings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
