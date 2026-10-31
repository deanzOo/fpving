import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import { Alerts } from "./alerts.tsx";
import { ClientContext } from "./client.ts";
import type { Client } from "./client.ts";
import { ErrorView } from "./error-view.tsx";
import { Layout } from "./layout.tsx";
import { Matches } from "./matches.tsx";
import { Plugins } from "./plugins.tsx";
import { SettingsScreen } from "./settings.tsx";
import { NotFound, Placeholder } from "./screens.tsx";
import { Watchlist } from "./watchlist.tsx";

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const placeholder = (path: string, title: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <Placeholder title={title} /> });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Watchlist }),
  placeholder("/products/$id", "Product"),
  createRoute({ getParentRoute: () => rootRoute, path: "/matches", component: Matches }),
  createRoute({ getParentRoute: () => rootRoute, path: "/alerts", component: Alerts }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/plugins", component: Plugins }),
]);

const createAppRouter = (history: RouterHistory) =>
  createRouter({ routeTree, history, defaultErrorComponent: ErrorView });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

interface AppProps {
  readonly client: Client;
  readonly queryClient: QueryClient;
  readonly history: RouterHistory;
}

/**
 * The app: the API client, the query cache and the router over `history`.
 *
 * @param props - The client, the query client and the history.
 * @returns The app.
 */
export const App = ({ client, queryClient, history }: AppProps) => {
  const [router] = useState(() => createAppRouter(history));
  return (
    <ClientContext value={client}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientContext>
  );
};
