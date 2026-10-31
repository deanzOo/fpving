import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";

const MAIN_ID = "main";

const NAV = [
  { to: "/", label: "Watchlist" },
  { to: "/matches", label: "Matches" },
  { to: "/alerts", label: "Alerts" },
  { to: "/settings", label: "Settings" },
  { to: "/plugins", label: "Plugins" },
] as const;

const skipClass
  = "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-surface focus:px-3";
const linkClass = "rounded-md px-3 py-2 font-medium text-ink-muted hover:text-ink";
const activeClass = "rounded-md px-3 py-2 font-medium text-ink bg-surface";

const UnreadBadge = ({ count }: { readonly count: number }) => (
  <span className="ml-2 rounded-full bg-action px-2 text-sm text-on-action" aria-hidden="true">{count}</span>
);

/**
 * The app frame: a skip link, the main navigation with the unread alert count, and the routed screen in `main`.
 *
 * @returns The layout.
 */
export const Layout = () => {
  const client = useClient();
  const unread = useQuery({
    queryKey: QueryKey.UnreadAlerts,
    queryFn: async () => client.listAlerts({ unread: "true" }),
  }).data?.length ?? 0;
  return (
    <>
      <a
        href={`#${MAIN_ID}`}
        className={skipClass}
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap gap-1 px-4 py-3">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={linkClass}
              activeProps={{ className: activeClass }}
              activeOptions={{ exact: true }}
              aria-label={to === "/alerts" && unread > 0 ? `${label}, ${String(unread)} unread` : undefined}
            >
              {label}
              {to === "/alerts" && unread > 0 ? <UnreadBadge count={unread} /> : null}
            </Link>
          ))}
        </nav>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </>
  );
};
