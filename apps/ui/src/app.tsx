import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import { Alerts } from "./alerts.tsx";
import { ClientContext } from "./client.ts";
import type { Client } from "./client.ts";
import { ErrorView } from "./error-view.tsx";
import { Layout } from "./layout.tsx";
import { Matches } from "./matches.tsx";
import { Plugins } from "./plugins.tsx";
import { ProductDetail } from "./product.tsx";
import { SettingsScreen } from "./settings.tsx";
import { NotFound } from "./screens.tsx";
import { Watchlist } from "./watchlist.tsx";

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const ProductPage = () => <ProductDetail id={productRoute.useParams().id} />;

const productRoute = createRoute({ getParentRoute: () => rootRoute, path: "/products/$id", component: ProductPage });

const watchlistRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Watchlist });
const matchesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/matches", component: Matches });
const alertsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/alerts", component: Alerts });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsScreen });
const pluginsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins", component: Plugins });
const atlasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/atlas",
  component: lazyRouteComponent(async () => import("./atlas.tsx"), "Atlas"),
});

const routeTree = rootRoute.addChildren([
  watchlistRoute,
  productRoute,
  matchesRoute,
  alertsRoute,
  settingsRoute,
  pluginsRoute,
  atlasRoute,
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
