import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { NavBar } from "./ui/nav-bar.tsx";

const MAIN_ID = "main";

/**
 * The app frame: a skip link, the main navigation with the unread alert count, and the routed screen in `main`,
 * which takes focus after each navigation so a screen reader starts at the new screen.
 *
 * @returns The layout.
 */
export const Layout = () => {
  const client = useClient();
  const unread = useQuery({
    queryKey: QueryKey.UnreadAlerts,
    queryFn: async () => client.listAlerts({ unread: "true" }),
  }).data?.length ?? 0;
  const main = useRef<HTMLElement>(null);
  const path = useRouterState({ select: ({ location }) => location.pathname });
  const shown = useRef(path);
  useEffect(() => {
    if (shown.current !== path) {
      shown.current = path;
      main.current?.focus();
    }
  }, [path]);
  return (
    <>
      <NavBar unread={unread} mainId={MAIN_ID} />
      <main ref={main} id={MAIN_ID} tabIndex={-1} className="mx-auto max-w-(--content-max) px-4 py-6">
        <Outlet />
      </main>
    </>
  );
};
